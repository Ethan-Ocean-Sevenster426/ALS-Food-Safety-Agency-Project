const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sql, getPool } = require('../config/db');
const { sendEmail, buildInviteEmail } = require('../services/emailService');

const router = express.Router();

// GET /api/company/:clientRecordId - get company details
router.get('/:clientRecordId', async (req, res) => {
  const { clientRecordId } = req.params;

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, parseInt(clientRecordId))
      .query('SELECT * FROM ConsolidatedMasterAbattoirDatabase WHERE Id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Company not found.' });
    }

    res.json({ company: result.recordset[0] });
  } catch (err) {
    console.error('Company fetch error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// PUT /api/company/:clientRecordId - update company details (Company Admin)
router.put('/:clientRecordId', async (req, res) => {
  const { clientRecordId } = req.params;
  const { updates, changedBy } = req.body;

  if (!updates || !changedBy) {
    return res.status(400).json({ message: 'updates and changedBy are required.' });
  }

  const EDITABLE_FIELDS = [
    'BusinessName', 'Email', 'Town', 'FacilityType', 'FacilityProvince',
    'CompanyRegNumber', 'PhysicalAddress', 'VATNumber',
    'AbattoirOwnerName', 'AbattoirOwnerCell', 'AbattoirOwnerEmail',
    'AccountsContactName', 'AccountsTelephone', 'AccountsEmail',
    'AbattoirManagerName', 'AbattoirManagerCell', 'AbattoirManagerEmail'
  ];

  try {
    const pool = await getPool();

    const current = await pool.request()
      .input('id', sql.Int, parseInt(clientRecordId))
      .query('SELECT * FROM ConsolidatedMasterAbattoirDatabase WHERE Id = @id');

    if (current.recordset.length === 0) {
      return res.status(404).json({ message: 'Record not found.' });
    }

    const oldRecord = current.recordset[0];
    const setClauses = [];
    const auditEntries = [];

    for (const [field, newValue] of Object.entries(updates)) {
      if (!EDITABLE_FIELDS.includes(field)) continue;
      const oldValue = oldRecord[field] || '';
      if (String(oldValue) === String(newValue)) continue;

      setClauses.push({ field, value: newValue });
      auditEntries.push({ field, oldValue: String(oldValue), newValue: String(newValue) });
    }

    if (setClauses.length === 0) {
      return res.json({ message: 'No changes detected.' });
    }

    const updateRequest = pool.request();
    updateRequest.input('id', sql.Int, parseInt(clientRecordId));
    const setParts = setClauses.map((c, i) => {
      updateRequest.input(`val${i}`, sql.NVarChar, String(c.value));
      return `${c.field} = @val${i}`;
    });

    await updateRequest.query(
      `UPDATE ConsolidatedMasterAbattoirDatabase SET ${setParts.join(', ')} WHERE Id = @id`
    );

    for (const entry of auditEntries) {
      await pool.request()
        .input('recordId', sql.Int, parseInt(clientRecordId))
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
    console.error('Company update error:', err);
    res.status(500).json({ message: 'Server error updating company.' });
  }
});

// GET /api/company/:clientRecordId/users - list users allocated to this company
router.get('/:clientRecordId/users', async (req, res) => {
  const { clientRecordId } = req.params;

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('clientRecordId', sql.Int, parseInt(clientRecordId))
      .query(
        `SELECT DISTINCT u.Id, u.FirstName, u.LastName, u.Email, u.Role, u.CreatedAt
         FROM Invitations i
         JOIN Users u ON LOWER(u.Email) = LOWER(i.Email)
         WHERE i.ClientRecordId = @clientRecordId AND i.Status = 'Accepted'
         ORDER BY u.CreatedAt DESC`
      );

    // Also get pending invites
    const pending = await pool.request()
      .input('clientRecordId', sql.Int, parseInt(clientRecordId))
      .query(
        `SELECT Id, Email, Role, CreatedAt
         FROM Invitations
         WHERE ClientRecordId = @clientRecordId AND Status = 'Pending'
         ORDER BY CreatedAt DESC`
      );

    res.json({
      users: result.recordset,
      pendingInvites: pending.recordset,
    });
  } catch (err) {
    console.error('Company users fetch error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// POST /api/company/:clientRecordId/invite - invite a user to this company
router.post('/:clientRecordId/invite', async (req, res) => {
  const { clientRecordId } = req.params;
  const { email, role, invitedBy } = req.body;

  if (!email || !role || !invitedBy) {
    return res.status(400).json({ message: 'email, role, and invitedBy are required.' });
  }

  if (!['Company Admin', 'User'].includes(role)) {
    return res.status(400).json({ message: 'Role must be Company Admin or User.' });
  }

  try {
    const pool = await getPool();

    const client = await pool.request()
      .input('id', sql.Int, parseInt(clientRecordId))
      .query('SELECT * FROM ConsolidatedMasterAbattoirDatabase WHERE Id = @id');

    if (client.recordset.length === 0) {
      return res.status(404).json({ message: 'Company not found.' });
    }

    const record = client.recordset[0];

    // Check for existing user
    const existingUser = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT Id FROM Users WHERE Email = @email');

    if (existingUser.recordset.length > 0) {
      return res.status(409).json({ message: 'A user with this email already exists.' });
    }

    // Expire old pending invites for this email + company
    await pool.request()
      .input('clientRecordId', sql.Int, parseInt(clientRecordId))
      .input('email', sql.NVarChar, email)
      .query("UPDATE Invitations SET Status = 'Expired' WHERE ClientRecordId = @clientRecordId AND Email = @email AND Status = 'Pending'");

    const token = crypto.randomBytes(32).toString('hex');

    await pool.request()
      .input('clientRecordId', sql.Int, parseInt(clientRecordId))
      .input('email', sql.NVarChar, email)
      .input('role', sql.NVarChar, role)
      .input('token', sql.NVarChar, token)
      .input('invitedBy', sql.NVarChar, invitedBy)
      .query(
        `INSERT INTO Invitations (ClientRecordId, Email, Role, Token, InvitedBy)
         VALUES (@clientRecordId, @email, @role, @token, @invitedBy)`
      );

    const inviteUrl = `http://localhost:3000/accept-invite/${token}`;
    const emailContent = buildInviteEmail({
      businessName: record.BusinessName,
      role,
      inviteUrl,
    });

    await sendEmail({
      to: email,
      subject: emailContent.subject,
      html: emailContent.html,
    });

    res.json({ message: `Invitation sent to ${email} as ${role}.` });
  } catch (err) {
    console.error('Company invite error:', err);
    res.status(500).json({ message: 'Failed to send invitation.' });
  }
});

// DELETE /api/company/:clientRecordId/users/:userId - remove a user from this company
router.delete('/:clientRecordId/users/:userId', async (req, res) => {
  const { clientRecordId, userId } = req.params;

  try {
    const pool = await getPool();

    // Verify the user belongs to this company
    const check = await pool.request()
      .input('userId', sql.Int, parseInt(userId))
      .input('clientRecordId', sql.Int, parseInt(clientRecordId))
      .query(
        `SELECT u.Id, u.Email FROM Users u
         JOIN Invitations i ON u.Email = i.Email
         WHERE u.Id = @userId AND i.ClientRecordId = @clientRecordId AND i.Status = 'Accepted'`
      );

    if (check.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found in this company.' });
    }

    await pool.request()
      .input('userId', sql.Int, parseInt(userId))
      .query('DELETE FROM Users WHERE Id = @userId');

    res.json({ message: 'User removed.' });
  } catch (err) {
    console.error('Company user delete error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// GET /api/company/:clientRecordId/audit-log - audit log for this company
router.get('/:clientRecordId/audit-log', async (req, res) => {
  const { clientRecordId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  try {
    const pool = await getPool();

    const countResult = await pool.request()
      .input('recordId', sql.Int, parseInt(clientRecordId))
      .query('SELECT COUNT(*) AS total FROM ClientAuditLog WHERE RecordId = @recordId');
    const total = countResult.recordset[0].total;

    const result = await pool.request()
      .input('recordId', sql.Int, parseInt(clientRecordId))
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limit)
      .query(
        `SELECT Id, RecordId, FieldName, OldValue, NewValue, ChangedBy, ChangedAt
         FROM ClientAuditLog
         WHERE RecordId = @recordId
         ORDER BY ChangedAt DESC
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
    console.error('Company audit log error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
