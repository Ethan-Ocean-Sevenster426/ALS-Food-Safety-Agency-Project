const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sql, getPool } = require('../config/db');
const { sendEmail, buildInviteEmail } = require('../services/emailService');

const router = express.Router();

// POST /api/invites - send an invitation
router.post('/', async (req, res) => {
  const { clientRecordId, role, invitedBy } = req.body;

  if (!clientRecordId || !role || !invitedBy) {
    return res.status(400).json({ message: 'clientRecordId, role, and invitedBy are required.' });
  }

  if (!['Company Admin', 'User'].includes(role)) {
    return res.status(400).json({ message: 'Role must be Company Admin or User.' });
  }

  try {
    const pool = await getPool();

    // Get the client record
    const client = await pool.request()
      .input('id', sql.Int, clientRecordId)
      .query('SELECT * FROM ConsolidatedMasterAbattoirDatabase WHERE Id = @id');

    if (client.recordset.length === 0) {
      return res.status(404).json({ message: 'Client record not found.' });
    }

    const record = client.recordset[0];
    const email = record.Email;

    if (!email) {
      return res.status(400).json({ message: 'This client has no email address on file.' });
    }

    // Check for existing pending invite
    const existing = await pool.request()
      .input('clientRecordId', sql.Int, clientRecordId)
      .input('status', sql.NVarChar, 'Pending')
      .query('SELECT Id FROM Invitations WHERE ClientRecordId = @clientRecordId AND Status = @status');

    if (existing.recordset.length > 0) {
      // Expire old invite
      await pool.request()
        .input('clientRecordId', sql.Int, clientRecordId)
        .input('status', sql.NVarChar, 'Expired')
        .query("UPDATE Invitations SET Status = @status WHERE ClientRecordId = @clientRecordId AND Status = 'Pending'");
    }

    // Generate unique token
    const token = crypto.randomBytes(32).toString('hex');

    // Save invitation
    await pool.request()
      .input('clientRecordId', sql.Int, clientRecordId)
      .input('email', sql.NVarChar, email)
      .input('role', sql.NVarChar, role)
      .input('token', sql.NVarChar, token)
      .input('invitedBy', sql.NVarChar, invitedBy)
      .query(
        `INSERT INTO Invitations (ClientRecordId, Email, Role, Token, InvitedBy)
         VALUES (@clientRecordId, @email, @role, @token, @invitedBy)`
      );

    // Send invite email
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
    console.error('Invite error:', err);
    res.status(500).json({ message: 'Failed to send invitation.' });
  }
});

// GET /api/invites/:token - get invite details (for registration page)
router.get('/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const pool = await getPool();

    const result = await pool.request()
      .input('token', sql.NVarChar, token)
      .query(
        `SELECT i.*, c.BusinessName, c.ClientID, c.AccountCode, c.Email as ClientEmail,
                c.ManualEmail, c.Town, c.FacilityType, c.FacilityProvince,
                c.CompanyRegNumber, c.PhysicalAddress, c.VATNumber,
                c.AbattoirOwnerName, c.AbattoirOwnerCell, c.AbattoirOwnerEmail,
                c.AccountsContactName, c.AccountsTelephone, c.AccountsEmail,
                c.AbattoirManagerName, c.AbattoirManagerCell, c.AbattoirManagerEmail
         FROM Invitations i
         JOIN ConsolidatedMasterAbattoirDatabase c ON i.ClientRecordId = c.Id
         WHERE i.Token = @token`
      );

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Invalid invitation link.' });
    }

    const invite = result.recordset[0];

    if (invite.Status !== 'Pending') {
      return res.status(400).json({ message: 'This invitation has already been used or expired.' });
    }

    res.json({ invite });
  } catch (err) {
    console.error('Invite lookup error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// POST /api/invites/:token/accept - accept invite, create user, set password
router.post('/:token/accept', async (req, res) => {
  const { token } = req.params;
  const { firstName, lastName, password, verificationData } = req.body;

  if (!firstName || !lastName || !password) {
    return res.status(400).json({ message: 'First name, last name, and password are required.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  }

  try {
    const pool = await getPool();

    // Get invite
    const inviteResult = await pool.request()
      .input('token', sql.NVarChar, token)
      .query('SELECT * FROM Invitations WHERE Token = @token AND Status = \'Pending\'');

    if (inviteResult.recordset.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired invitation.' });
    }

    const invite = inviteResult.recordset[0];

    // Check if user already exists
    const existingUser = await pool.request()
      .input('email', sql.NVarChar, invite.Email)
      .query('SELECT Id FROM Users WHERE Email = @email');

    if (existingUser.recordset.length > 0) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    // Create user
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    await pool.request()
      .input('firstName', sql.NVarChar, firstName)
      .input('lastName', sql.NVarChar, lastName)
      .input('email', sql.NVarChar, invite.Email)
      .input('passwordHash', sql.NVarChar, passwordHash)
      .input('role', sql.NVarChar, invite.Role)
      .query(
        'INSERT INTO Users (FirstName, LastName, Email, PasswordHash, Role) VALUES (@firstName, @lastName, @email, @passwordHash, @role)'
      );

    // Mark invite as accepted
    await pool.request()
      .input('token', sql.NVarChar, token)
      .query("UPDATE Invitations SET Status = 'Accepted', AcceptedAt = GETDATE() WHERE Token = @token");

    // If Company Admin and verification data provided, update the client record and log changes
    if (invite.Role === 'Company Admin' && verificationData) {
      const fields = [
        'BusinessName', 'FacilityProvince', 'CompanyRegNumber', 'PhysicalAddress', 'VATNumber',
        'AbattoirOwnerName', 'AbattoirOwnerCell', 'AbattoirOwnerEmail',
        'AccountsContactName', 'AccountsTelephone', 'AccountsEmail',
        'AbattoirManagerName', 'AbattoirManagerCell', 'AbattoirManagerEmail'
      ];

      const changedBy = `${firstName} ${lastName} (${invite.Email}) [Registration]`;

      // Fetch old record for audit comparison
      const oldRecord = await pool.request()
        .input('recId', sql.Int, invite.ClientRecordId)
        .query('SELECT * FROM ConsolidatedMasterAbattoirDatabase WHERE Id = @recId');

      const oldData = oldRecord.recordset.length > 0 ? oldRecord.recordset[0] : {};

      const updateReq = pool.request();
      updateReq.input('id', sql.Int, invite.ClientRecordId);
      updateReq.input('verifiedBy', sql.NVarChar, `${firstName} ${lastName} (${invite.Email})`);

      const setParts = [];
      const auditEntries = [];

      fields.forEach((field, i) => {
        if (verificationData[field] !== undefined) {
          const newVal = String(verificationData[field] || '');
          const oldVal = String(oldData[field] || '');
          updateReq.input(`f${i}`, sql.NVarChar, newVal);
          setParts.push(`${field} = @f${i}`);

          if (newVal !== oldVal) {
            auditEntries.push({ field, oldValue: oldVal, newValue: newVal });
          }
        }
      });
      setParts.push('VerifiedAt = GETDATE()');
      setParts.push('VerifiedBy = @verifiedBy');

      if (setParts.length > 0) {
        await updateReq.query(
          `UPDATE ConsolidatedMasterAbattoirDatabase SET ${setParts.join(', ')} WHERE Id = @id`
        );
      }

      // Log each changed field to the audit log
      for (const entry of auditEntries) {
        await pool.request()
          .input('recordId', sql.Int, invite.ClientRecordId)
          .input('fieldName', sql.NVarChar, entry.field)
          .input('oldValue', sql.NVarChar, entry.oldValue)
          .input('newValue', sql.NVarChar, entry.newValue)
          .input('changedBy', sql.NVarChar, changedBy)
          .query(
            `INSERT INTO ClientAuditLog (RecordId, FieldName, OldValue, NewValue, ChangedBy)
             VALUES (@recordId, @fieldName, @oldValue, @newValue, @changedBy)`
          );
      }

      // Log the verification event itself
      await pool.request()
        .input('recordId', sql.Int, invite.ClientRecordId)
        .input('fieldName', sql.NVarChar, '_VERIFIED')
        .input('oldValue', sql.NVarChar, '')
        .input('newValue', sql.NVarChar, `Verified by ${firstName} ${lastName} (${invite.Email})`)
        .input('changedBy', sql.NVarChar, changedBy)
        .query(
          `INSERT INTO ClientAuditLog (RecordId, FieldName, OldValue, NewValue, ChangedBy)
           VALUES (@recordId, @fieldName, @oldValue, @newValue, @changedBy)`
        );
    }

    res.json({ message: 'Account created successfully. You can now sign in.' });
  } catch (err) {
    console.error('Accept invite error:', err);
    res.status(500).json({ message: 'Server error accepting invitation.' });
  }
});

module.exports = router;
