const express = require('express');
const XLSX = require('xlsx');
const { sql, getPool } = require('../config/db');
const { sendEmail } = require('../services/emailService');

const router = express.Router();

const EDITABLE_FIELDS = [
  'BusinessName', 'AccountCode', 'Email',
  'Town', 'FacilityType', 'FacilityProvince',
  'CompanyRegNumber', 'PhysicalAddress', 'VATNumber',
  'AbattoirOwnerName', 'AbattoirOwnerCell', 'AbattoirOwnerEmail',
  'AccountsContactName', 'AccountsTelephone', 'AccountsEmail',
  'AbattoirManagerName', 'AbattoirManagerCell', 'AbattoirManagerEmail'
];

// GET /api/clients - list all clients with optional search & pagination
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    let whereClauseUnqualified = '';
    let whereClauseQualified = '';
    const request = pool.request();

    if (search) {
      whereClauseUnqualified = `WHERE BusinessName LIKE @search OR AccountCode LIKE @search OR Email LIKE @search OR Town LIKE @search OR FacilityProvince LIKE @search`;
      whereClauseQualified =   `WHERE c.BusinessName LIKE @search OR c.AccountCode LIKE @search OR c.Email LIKE @search OR c.Town LIKE @search OR c.FacilityProvince LIKE @search`;
      request.input('search', sql.NVarChar, `%${search}%`);
    }

    const countResult = await request.query(
      `SELECT COUNT(*) AS total FROM ConsolidatedMasterAbattoirDatabase ${whereClauseUnqualified}`
    );
    const total = countResult.recordset[0].total;

    const dataRequest = pool.request();
    if (search) {
      dataRequest.input('search', sql.NVarChar, `%${search}%`);
    }
    dataRequest.input('offset', sql.Int, offset);
    dataRequest.input('limit', sql.Int, limit);

    const result = await dataRequest.query(
      `SELECT c.Id, c.BusinessName, c.AccountCode, c.Email, c.Town, c.FacilityType, c.FacilityProvince,
              c.CompanyRegNumber, c.PhysicalAddress, c.VATNumber,
              c.AbattoirOwnerName, c.AbattoirOwnerCell, c.AbattoirOwnerEmail,
              c.AccountsContactName, c.AccountsTelephone, c.AccountsEmail,
              c.AbattoirManagerName, c.AbattoirManagerCell, c.AbattoirManagerEmail,
              c.EPVCycleStatus, c.ApprovalStatus, c.AssignedInspectorId,
              insp.FirstName           AS InspFirstName,
              insp.LastName            AS InspLastName,
              onboarding.AcceptedAt    AS OnboardedAt,
              onboarding.Email         AS OnboardedBy
       FROM ConsolidatedMasterAbattoirDatabase c
       LEFT JOIN Users insp ON insp.Id = c.AssignedInspectorId
       LEFT JOIN (
         SELECT ClientRecordId, AcceptedAt, Email,
                ROW_NUMBER() OVER (PARTITION BY ClientRecordId ORDER BY AcceptedAt ASC) AS rn
         FROM Invitations
         WHERE Role = 'Company Admin' AND Status = 'Accepted'
       ) onboarding ON onboarding.ClientRecordId = c.Id AND onboarding.rn = 1
       ${whereClauseQualified}
       ORDER BY c.Id
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`
    );

    res.json({
      data: result.recordset.map(r => ({
        ...r,
        AssignedInspectorName: [r.InspFirstName, r.InspLastName].filter(Boolean).join(' ') || null,
      })),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('Clients fetch error:', err);
    res.status(500).json({ message: 'Server error fetching clients.' });
  }
});

// GET /api/clients/export.xlsx - full facility export honouring the search filter
router.get('/export.xlsx', async (req, res) => {
  try {
    const pool = await getPool();
    const search = req.query.search || '';
    const request = pool.request();
    let whereQ = '';
    if (search) {
      whereQ = `WHERE c.BusinessName LIKE @search OR c.AccountCode LIKE @search OR c.Email LIKE @search OR c.Town LIKE @search OR c.FacilityProvince LIKE @search`;
      request.input('search', sql.NVarChar, `%${search}%`);
    }
    const rows = (await request.query(`
      SELECT c.Id, c.BusinessName, c.AccountCode, c.Email, c.Town, c.FacilityType, c.FacilityProvince,
             c.CompanyRegNumber, c.PhysicalAddress, c.VATNumber,
             c.AbattoirOwnerName, c.AbattoirOwnerCell, c.AbattoirOwnerEmail,
             c.AccountsContactName, c.AccountsTelephone, c.AccountsEmail,
             c.AbattoirManagerName, c.AbattoirManagerCell, c.AbattoirManagerEmail,
             c.EPVCycleStatus,
             onboarding.AcceptedAt AS OnboardedAt,
             onboarding.Email      AS OnboardedBy,
             u.FirstName AS AssignedInspectorFirstName,
             u.LastName  AS AssignedInspectorLastName
      FROM ConsolidatedMasterAbattoirDatabase c
      LEFT JOIN (
        SELECT ClientRecordId, AcceptedAt, Email,
               ROW_NUMBER() OVER (PARTITION BY ClientRecordId ORDER BY AcceptedAt ASC) AS rn
        FROM Invitations
        WHERE Role = 'Company Admin' AND Status = 'Accepted'
      ) onboarding ON onboarding.ClientRecordId = c.Id AND onboarding.rn = 1
      LEFT JOIN Users u ON c.AssignedInspectorId = u.Id
      ${whereQ}
      ORDER BY c.BusinessName
    `)).recordset;

    const shaped = rows.map(r => ({
      Facility: r.BusinessName,
      AccountCode: r.AccountCode,
      Email: r.Email,
      Town: r.Town,
      FacilityType: r.FacilityType,
      Province: r.FacilityProvince,
      CompanyRegNumber: r.CompanyRegNumber,
      PhysicalAddress: r.PhysicalAddress,
      VATNumber: r.VATNumber,
      OwnerName: r.AbattoirOwnerName,
      OwnerCell: r.AbattoirOwnerCell,
      OwnerEmail: r.AbattoirOwnerEmail,
      AccountsContact: r.AccountsContactName,
      AccountsTelephone: r.AccountsTelephone,
      AccountsEmail: r.AccountsEmail,
      ManagerName: r.AbattoirManagerName,
      ManagerCell: r.AbattoirManagerCell,
      ManagerEmail: r.AbattoirManagerEmail,
      Verified: r.OnboardedAt ? 'Yes' : 'No',
      OnboardedAt: r.OnboardedAt || '',
      OnboardedBy: r.OnboardedBy || '',
      OnEPVCycle: r.EPVCycleStatus === 'On EPV Cycle' ? 'Yes' : 'No',
      AssignedInspector: [r.AssignedInspectorFirstName, r.AssignedInspectorLastName].filter(Boolean).join(' ') || '',
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(shaped.length ? shaped : [{}]);
    if (shaped.length > 0) {
      const cols = Object.keys(shaped[0]);
      ws['!cols'] = cols.map(col => {
        let maxLen = col.length;
        for (const row of shaped.slice(0, 100)) {
          const v = row[col];
          if (v != null) maxLen = Math.max(maxLen, String(v).length);
        }
        return { wch: Math.min(maxLen + 2, 40) };
      });
    }
    XLSX.utils.book_append_sheet(wb, ws, 'Master Facility Database');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = `Consolidated Master Facility Database - ${stamp}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buf);
  } catch (err) {
    console.error('Clients export error:', err);
    res.status(500).json({ message: 'Failed to export facilities.' });
  }
});

// POST /api/clients - create a new client record
router.post('/', async (req, res) => {
  const { client, createdBy } = req.body;

  if (!client || !createdBy) {
    return res.status(400).json({ message: 'client and createdBy are required.' });
  }

  try {
    const pool = await getPool();
    const request = pool.request();

    EDITABLE_FIELDS.forEach((field, i) => {
      request.input(`f${i}`, sql.NVarChar, String(client[field] || ''));
    });

    const columns = EDITABLE_FIELDS.join(', ');
    const params = EDITABLE_FIELDS.map((_, i) => `@f${i}`).join(', ');

    const result = await request.query(
      `INSERT INTO ConsolidatedMasterAbattoirDatabase (${columns}) OUTPUT INSERTED.Id VALUES (${params})`
    );

    const newId = result.recordset[0].Id;

    // Log the creation in the audit log
    await pool.request()
      .input('recordId', sql.Int, newId)
      .input('fieldName', sql.NVarChar, '_CREATED')
      .input('oldValue', sql.NVarChar, '')
      .input('newValue', sql.NVarChar, `New record: ${client.BusinessName || 'Unknown'}`)
      .input('changedBy', sql.NVarChar, createdBy)
      .query(
        `INSERT INTO ClientAuditLog (RecordId, FieldName, OldValue, NewValue, ChangedBy)
         VALUES (@recordId, @fieldName, @oldValue, @newValue, @changedBy)`
      );

    res.status(201).json({ message: 'Client created.', id: newId });
  } catch (err) {
    console.error('Client create error:', err);
    res.status(500).json({ message: 'Server error creating client.' });
  }
});

// PUT /api/clients/:id - update a client record and log changes
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body.updates; // { field: newValue, ... }
  const changedBy = req.body.changedBy; // user email or name

  if (!updates || !changedBy) {
    return res.status(400).json({ message: 'updates and changedBy are required.' });
  }

  try {
    const pool = await getPool();

    // Fetch current record
    const current = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT * FROM ConsolidatedMasterAbattoirDatabase WHERE Id = @id');

    if (current.recordset.length === 0) {
      return res.status(404).json({ message: 'Record not found.' });
    }

    const oldRecord = current.recordset[0];

    // Build update SET clause and audit log entries
    const setClauses = [];
    const auditEntries = [];

    for (const [field, newValue] of Object.entries(updates)) {
      if (field === 'AssignedInspectorId') {
        const newId = (newValue === '' || newValue === null || newValue === undefined)
          ? null : parseInt(newValue);
        const oldId = oldRecord.AssignedInspectorId || null;
        if (newId === oldId) continue;

        // Resolve names so the audit log reads like the rest of the change log
        const inspectorLabel = async (userId) => {
          if (!userId) return '(none)';
          const r = await pool.request()
            .input('uid', sql.Int, userId)
            .query('SELECT FirstName, LastName FROM Users WHERE Id = @uid');
          const u = r.recordset[0];
          return u ? `${u.FirstName || ''} ${u.LastName || ''}`.trim() : `User #${userId}`;
        };
        setClauses.push({ field, value: newId, isInt: true });
        auditEntries.push({
          field: 'AssignedInspector',
          oldValue: await inspectorLabel(oldId),
          newValue: await inspectorLabel(newId),
        });
        continue;
      }
      if (!EDITABLE_FIELDS.includes(field)) continue;
      const oldValue = oldRecord[field] || '';
      if (String(oldValue) === String(newValue)) continue; // no change

      setClauses.push({ field, value: newValue });
      auditEntries.push({ field, oldValue: String(oldValue), newValue: String(newValue) });
    }

    if (setClauses.length === 0) {
      return res.json({ message: 'No changes detected.' });
    }

    // Update the record
    const updateRequest = pool.request();
    updateRequest.input('id', sql.Int, parseInt(id));
    const setParts = setClauses.map((c, i) => {
      if (c.isInt) {
        updateRequest.input(`val${i}`, sql.Int, c.value);
      } else {
        updateRequest.input(`val${i}`, sql.NVarChar, String(c.value));
      }
      return `${c.field} = @val${i}`;
    });

    await updateRequest.query(
      `UPDATE ConsolidatedMasterAbattoirDatabase SET ${setParts.join(', ')} WHERE Id = @id`
    );

    // Insert audit log entries
    for (const entry of auditEntries) {
      await pool.request()
        .input('recordId', sql.Int, parseInt(id))
        .input('fieldName', sql.NVarChar, entry.field)
        .input('oldValue', sql.NVarChar, entry.oldValue)
        .input('newValue', sql.NVarChar, entry.newValue)
        .input('changedBy', sql.NVarChar, changedBy)
        .query(
          `INSERT INTO ClientAuditLog (RecordId, FieldName, OldValue, NewValue, ChangedBy)
           VALUES (@recordId, @fieldName, @oldValue, @newValue, @changedBy)`
        );
    }

    res.json({ message: `${auditEntries.length} field(s) updated.`, changes: auditEntries });
  } catch (err) {
    console.error('Client update error:', err);
    res.status(500).json({ message: 'Server error updating client.' });
  }
});

// DELETE /api/clients/:id - delete a client record
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const deletedBy = (req.body && req.body.deletedBy) || 'Unknown';

  try {
    const pool = await getPool();

    // Fetch current record before deleting
    const current = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT * FROM ConsolidatedMasterAbattoirDatabase WHERE Id = @id');

    if (current.recordset.length === 0) {
      return res.status(404).json({ message: 'Record not found.' });
    }

    const record = current.recordset[0];

    // Clean up related records that reference this client
    await pool.request().input('id', sql.Int, parseInt(id))
      .query('DELETE FROM ClientAuditLog WHERE RecordId = @id');

    // Clean up invitations referencing this client
    try {
      await pool.request().input('id', sql.Int, parseInt(id))
        .query('DELETE FROM Invitations WHERE ClientRecordId = @id');
    } catch (e) { /* table may not exist */ }

    // Clean up EPV child rows before the EPVs themselves (FK chain).
    try {
      await pool.request().input('id', sql.Int, parseInt(id))
        .query(`DELETE FROM EPVAuditLog WHERE VerificationId IN
                (SELECT Id FROM EggProductionVerifications WHERE ClientRecordId = @id)`);
    } catch (e) { /* table may not exist */ }
    try {
      await pool.request().input('id', sql.Int, parseInt(id))
        .query(`DELETE FROM EPVInvoices WHERE VerificationId IN
                (SELECT Id FROM EggProductionVerifications WHERE ClientRecordId = @id)`);
    } catch (e) { /* table may not exist */ }
    try {
      await pool.request().input('id', sql.Int, parseInt(id))
        .query(`DELETE FROM EPVAttachments WHERE VerificationId IN
                (SELECT Id FROM EggProductionVerifications WHERE ClientRecordId = @id)`);
    } catch (e) { /* table may not exist */ }

    // Clean up EPVs referencing this client
    try {
      await pool.request().input('id', sql.Int, parseInt(id))
        .query('DELETE FROM EggProductionVerifications WHERE ClientRecordId = @id');
    } catch (e) {
      // Real FK errors should surface, not be swallowed.
      console.error('EPV delete error:', e.message);
      return res.status(500).json({ message: 'Could not delete this facility: historical EPV data is blocking the delete. ' + e.message });
    }

    // Nullify support tickets referencing this client (don't delete tickets)
    try {
      await pool.request().input('id', sql.Int, parseInt(id))
        .query('UPDATE SupportTickets SET ClientRecordId = NULL WHERE ClientRecordId = @id');
    } catch (e) { /* table may not exist */ }

    // Delete the client record
    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('DELETE FROM ConsolidatedMasterAbattoirDatabase WHERE Id = @id');

    // Log deletion with RecordId 0 (record no longer exists)
    await pool.request()
      .input('recordId', sql.Int, 0)
      .input('fieldName', sql.NVarChar, '_DELETED')
      .input('oldValue', sql.NVarChar, `${record.BusinessName}`)
      .input('newValue', sql.NVarChar, '')
      .input('changedBy', sql.NVarChar, deletedBy)
      .query(
        `INSERT INTO ClientAuditLog (RecordId, FieldName, OldValue, NewValue, ChangedBy)
         VALUES (@recordId, @fieldName, @oldValue, @newValue, @changedBy)`
      );

    res.json({ message: 'Client deleted.' });
  } catch (err) {
    console.error('Client delete error:', err);
    res.status(500).json({ message: 'Server error deleting client.' });
  }
});

// GET /api/clients/pending - list pending company registrations
router.get('/pending', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      `SELECT Id, BusinessName, AccountCode, Email, Town, FacilityType, FacilityProvince,
              CompanyRegNumber, PhysicalAddress, VATNumber,
              AbattoirOwnerName, AbattoirOwnerCell, AbattoirOwnerEmail,
              AccountsContactName, AccountsTelephone, AccountsEmail,
              AbattoirManagerName, AbattoirManagerCell, AbattoirManagerEmail,
              ApprovalStatus
       FROM ConsolidatedMasterAbattoirDatabase
       WHERE ApprovalStatus = 'Pending'
       ORDER BY Id DESC`
    );
    res.json({ data: result.recordset });
  } catch (err) {
    console.error('Pending clients fetch error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// PUT /api/clients/approve/:id - approve a pending company registration
router.put('/approve/:id', async (req, res) => {
  const { id } = req.params;
  const { approvedBy } = req.body;

  if (!approvedBy) {
    return res.status(400).json({ message: 'approvedBy is required.' });
  }

  try {
    const pool = await getPool();

    const client = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT * FROM ConsolidatedMasterAbattoirDatabase WHERE Id = @id');

    if (client.recordset.length === 0) {
      return res.status(404).json({ message: 'Company not found.' });
    }

    const record = client.recordset[0];

    if (record.ApprovalStatus !== 'Pending') {
      return res.status(400).json({ message: `Company is already ${record.ApprovalStatus}.` });
    }

    // Update approval status
    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query("UPDATE ConsolidatedMasterAbattoirDatabase SET ApprovalStatus = 'Approved' WHERE Id = @id");

    // Activate the user account
    const userEmail = record.Email;
    if (userEmail) {
      await pool.request()
        .input('email', sql.NVarChar, userEmail)
        .query('UPDATE Users SET IsActive = 1 WHERE LOWER(Email) = LOWER(@email) AND IsActive = 0');
    }

    // Send approval notification email
    if (userEmail) {
      try {
        await sendEmail({
          to: userEmail,
          subject: 'EPVS - Your Company Registration Has Been Approved',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #0E7C7B 0%, #065f5e 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                <h1 style="color: #fff; margin: 0; font-size: 28px;">EPVS</h1>
                <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Egg Production Verification System</p>
              </div>
              <div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                <h2 style="color: #059669; margin-top: 0;">Registration Approved</h2>
                <p style="color: #555; font-size: 15px; line-height: 1.6;">
                  Your company <strong>${record.BusinessName}</strong> has been approved on the Egg Production Verification System. You can now log in and access your account.
                </p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="https://egg-production-verification.fsa-pty.co.za/login" style="display: inline-block; background-color: #0E7C7B; color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
                    Sign In
                  </a>
                </div>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error('Approval email failed:', emailErr.message);
      }
    }

    // Audit log
    await pool.request()
      .input('recordId', sql.Int, parseInt(id))
      .input('fieldName', sql.NVarChar, 'ApprovalStatus')
      .input('oldValue', sql.NVarChar, 'Pending')
      .input('newValue', sql.NVarChar, 'Approved')
      .input('changedBy', sql.NVarChar, approvedBy)
      .query(
        `INSERT INTO ClientAuditLog (RecordId, FieldName, OldValue, NewValue, ChangedBy)
         VALUES (@recordId, @fieldName, @oldValue, @newValue, @changedBy)`
      );

    res.json({ message: `${record.BusinessName} has been approved. Notification sent to ${userEmail}.` });
  } catch (err) {
    console.error('Approval error:', err);
    res.status(500).json({ message: 'Server error approving company.' });
  }
});

// PUT /api/clients/reject/:id - reject a pending company registration
router.put('/reject/:id', async (req, res) => {
  const { id } = req.params;
  const { rejectedBy, reason } = req.body;

  if (!rejectedBy) {
    return res.status(400).json({ message: 'rejectedBy is required.' });
  }

  try {
    const pool = await getPool();

    const client = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT * FROM ConsolidatedMasterAbattoirDatabase WHERE Id = @id');

    if (client.recordset.length === 0) {
      return res.status(404).json({ message: 'Company not found.' });
    }

    const record = client.recordset[0];

    if (record.ApprovalStatus !== 'Pending') {
      return res.status(400).json({ message: `Company is already ${record.ApprovalStatus}.` });
    }

    // Send rejection notification email before deleting
    const userEmail = record.Email;
    if (userEmail) {
      try {
        await sendEmail({
          to: userEmail,
          subject: 'EPVS - Company Registration Update',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #0E7C7B 0%, #065f5e 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                <h1 style="color: #fff; margin: 0; font-size: 28px;">EPVS</h1>
                <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Egg Production Verification System</p>
              </div>
              <div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                <h2 style="color: #dc2626; margin-top: 0;">Registration Not Approved</h2>
                <p style="color: #555; font-size: 15px; line-height: 1.6;">
                  Your registration for <strong>${record.BusinessName}</strong> has not been approved.${reason ? ` Reason: ${reason}` : ''}
                </p>
                <p style="color: #555; font-size: 15px; line-height: 1.6;">
                  If you believe this is an error, please contact the EPVS administration team.
                </p>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error('Rejection email failed:', emailErr.message);
      }
    }

    // Delete related invitations
    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('DELETE FROM Invitations WHERE ClientRecordId = @id');

    // Delete related user account (created during self-registration)
    if (userEmail) {
      await pool.request()
        .input('email', sql.NVarChar, userEmail)
        .query('DELETE FROM Users WHERE LOWER(Email) = LOWER(@email)');
    }

    // Delete audit log entries for this record
    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('DELETE FROM ClientAuditLog WHERE RecordId = @id');

    // Delete the client record itself
    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('DELETE FROM ConsolidatedMasterAbattoirDatabase WHERE Id = @id');

    res.json({ message: `${record.BusinessName} has been rejected and removed.` });
  } catch (err) {
    console.error('Rejection error:', err);
    res.status(500).json({ message: 'Server error rejecting company.' });
  }
});

// GET /api/clients/audit-log - get audit log with optional filters
router.get('/audit-log', async (req, res) => {
  try {
    const pool = await getPool();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const recordId = req.query.recordId || '';
    const offset = (page - 1) * limit;

    let whereClause = '';
    const countReq = pool.request();
    const dataReq = pool.request();

    if (recordId) {
      whereClause = 'WHERE a.RecordId = @recordId';
      countReq.input('recordId', sql.Int, parseInt(recordId));
      dataReq.input('recordId', sql.Int, parseInt(recordId));
    }

    const countResult = await countReq.query(
      `SELECT COUNT(*) AS total FROM ClientAuditLog a ${whereClause}`
    );
    const total = countResult.recordset[0].total;

    dataReq.input('offset', sql.Int, offset);
    dataReq.input('limit', sql.Int, limit);

    const result = await dataReq.query(
      `SELECT a.Id, a.RecordId, c.BusinessName, a.FieldName, a.OldValue, a.NewValue, a.ChangedBy, a.ChangedAt
       FROM ClientAuditLog a
       LEFT JOIN ConsolidatedMasterAbattoirDatabase c ON a.RecordId = c.Id
       ${whereClause}
       ORDER BY a.ChangedAt DESC
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`
    );

    res.json({
      data: result.recordset,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('Audit log fetch error:', err);
    res.status(500).json({ message: 'Server error fetching audit log.' });
  }
});

module.exports = router;
