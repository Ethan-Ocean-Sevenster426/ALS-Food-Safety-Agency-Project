const express = require('express');
const { sql, getPool } = require('../config/db');

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
              c.EPVCycleStatus,
              onboarding.AcceptedAt    AS OnboardedAt,
              onboarding.Email         AS OnboardedBy
       FROM ConsolidatedMasterAbattoirDatabase c
       LEFT JOIN LATERAL (
         SELECT AcceptedAt, Email
         FROM Invitations
         WHERE ClientRecordId = c.Id
           AND Role = 'Company Admin'
           AND Status = 'Accepted'
         ORDER BY AcceptedAt ASC
         LIMIT 1
       ) onboarding ON true
       ${whereClauseQualified}
       ORDER BY c.Id
       OFFSET @offset LIMIT @limit`
    );

    res.json({
      data: result.recordset,
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
      updateRequest.input(`val${i}`, sql.NVarChar, String(c.value));
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
