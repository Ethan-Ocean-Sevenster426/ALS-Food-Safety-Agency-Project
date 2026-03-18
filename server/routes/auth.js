const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sql, getPool } = require('../config/db');
const { sendEmail } = require('../services/emailService');

const router = express.Router();

const VALID_ROLES = ['Super Admin', 'Admin', 'Company Admin', 'User'];

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password, role } = req.body;

  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ message: 'All fields are required.' });
  }

  const assignedRole = VALID_ROLES.includes(role) ? role : 'User';

  try {
    const pool = await getPool();

    const existing = await pool
      .request()
      .input('email', sql.NVarChar, email)
      .query('SELECT Id FROM Users WHERE Email = @email');

    if (existing.recordset.length > 0) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    await pool
      .request()
      .input('firstName', sql.NVarChar, firstName)
      .input('lastName', sql.NVarChar, lastName)
      .input('email', sql.NVarChar, email)
      .input('passwordHash', sql.NVarChar, passwordHash)
      .input('role', sql.NVarChar, assignedRole)
      .query(
        'INSERT INTO Users (FirstName, LastName, Email, PasswordHash, Role) VALUES (@firstName, @lastName, @email, @passwordHash, @role)'
      );

    res.status(201).json({ message: 'Account created successfully.' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const pool = await getPool();

    const result = await pool
      .request()
      .input('email', sql.NVarChar, email)
      .query(
        `SELECT TOP 1 u.Id, u.FirstName, u.LastName, u.Email, u.PasswordHash, u.Role, ISNULL(u.IsActive, 1) AS IsActive,
                i.ClientRecordId
         FROM Users u
         LEFT JOIN Invitations i ON LOWER(u.Email) = LOWER(i.Email) AND i.Status = 'Accepted'
         WHERE LOWER(u.Email) = LOWER(@email)
         ORDER BY i.AcceptedAt DESC`
      );

    if (result.recordset.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const user = result.recordset[0];

    if (user.IsActive === false || user.IsActive === 0) {
      return res.status(403).json({ message: 'Your account has been deactivated. Please contact an administrator.' });
    }

    const isMatch = await bcrypt.compare(password, user.PasswordHash);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: user.Id, email: user.Email, firstName: user.FirstName, role: user.Role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful.',
      token,
      user: {
        id: user.Id,
        firstName: user.FirstName,
        lastName: user.LastName,
        email: user.Email,
        role: user.Role,
        clientRecordId: user.ClientRecordId || null,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// GET /api/auth/users - list all users (admin only)
router.get('/users', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      `;WITH UserAllocations AS (
         SELECT u.Id, u.FirstName, u.LastName, u.Email, u.Role, u.CreatedAt, ISNULL(u.IsActive, 1) AS IsActive,
                c.BusinessName AS AllocatedClient, c.ClientID AS AllocatedClientID,
                ROW_NUMBER() OVER (PARTITION BY u.Id ORDER BY i.AcceptedAt DESC) AS rn
         FROM Users u
         LEFT JOIN Invitations i ON LOWER(i.Email) = LOWER(u.Email) AND i.Status = 'Accepted'
         LEFT JOIN ConsolidatedMasterAbattoirDatabase c ON i.ClientRecordId = c.Id
       )
       SELECT Id, FirstName, LastName, Email, Role, CreatedAt, AllocatedClient, AllocatedClientID, IsActive
       FROM UserAllocations
       WHERE rn = 1
       ORDER BY CreatedAt DESC`
    );
    res.json({ users: result.recordset });
  } catch (err) {
    console.error('Users fetch error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// PUT /api/auth/users/:id/role - update a user's role
router.put('/users/:id/role', async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ message: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
  }

  try {
    const pool = await getPool();

    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT Id, Email FROM Users WHERE Id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('role', sql.NVarChar, role)
      .query('UPDATE Users SET Role = @role WHERE Id = @id');

    res.json({ message: 'Role updated successfully.' });
  } catch (err) {
    console.error('Role update error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// PUT /api/auth/users/:id/reset-password - reset a user's password (admin only)
router.put('/users/:id/reset-password', async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  }

  try {
    const pool = await getPool();

    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT Id, Email FROM Users WHERE Id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('passwordHash', sql.NVarChar, passwordHash)
      .query('UPDATE Users SET PasswordHash = @passwordHash WHERE Id = @id');

    res.json({ message: 'Password reset successfully.' });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// PUT /api/auth/users/:id - edit user details
router.put('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { firstName, lastName, email, role } = req.body;

  if (!firstName || !lastName || !email) {
    return res.status(400).json({ message: 'First name, last name, and email are required.' });
  }

  if (role && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ message: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
  }

  try {
    const pool = await getPool();

    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT Id, Email FROM Users WHERE Id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Check if email is taken by another user
    const emailCheck = await pool.request()
      .input('email', sql.NVarChar, email)
      .input('id', sql.Int, parseInt(id))
      .query('SELECT Id FROM Users WHERE LOWER(Email) = LOWER(@email) AND Id != @id');

    if (emailCheck.recordset.length > 0) {
      return res.status(409).json({ message: 'Another account with this email already exists.' });
    }

    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('firstName', sql.NVarChar, firstName)
      .input('lastName', sql.NVarChar, lastName)
      .input('email', sql.NVarChar, email)
      .input('role', sql.NVarChar, role || 'User')
      .query('UPDATE Users SET FirstName = @firstName, LastName = @lastName, Email = @email, Role = @role WHERE Id = @id');

    res.json({ message: 'User updated successfully.' });
  } catch (err) {
    console.error('User update error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// PUT /api/auth/users/:id/deactivate - toggle user active status
router.put('/users/:id/deactivate', async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;

  try {
    const pool = await getPool();

    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT Id, FirstName, LastName, IsActive FROM Users WHERE Id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const newStatus = typeof isActive === 'boolean' ? isActive : !result.recordset[0].IsActive;

    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('isActive', sql.Bit, newStatus)
      .query('UPDATE Users SET IsActive = @isActive WHERE Id = @id');

    res.json({
      message: newStatus ? 'User activated.' : 'User deactivated.',
      isActive: newStatus,
    });
  } catch (err) {
    console.error('Deactivate error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// DELETE /api/auth/users/:id - delete a user
router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await getPool();

    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT Id FROM Users WHERE Id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('DELETE FROM Users WHERE Id = @id');

    res.json({ message: 'User deleted.' });
  } catch (err) {
    console.error('User delete error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// POST /api/auth/forgot-password - send password reset email
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required.' });
  }

  try {
    const pool = await getPool();

    const result = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT Id, FirstName, LastName, Email FROM Users WHERE LOWER(Email) = LOWER(@email)');

    if (result.recordset.length === 0) {
      // Don't reveal whether email exists
      return res.json({ message: 'If an account with that email exists, a reset link has been sent.' });
    }

    const user = result.recordset[0];
    const resetToken = jwt.sign(
      { userId: user.Id, email: user.Email, purpose: 'password-reset' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const resetUrl = `http://localhost:3000/reset-password/${resetToken}`;

    await sendEmail({
      to: user.Email,
      subject: 'EPVS - Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: #fff; margin: 0; font-size: 28px;">EPVS</h1>
            <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Egg Production Verification System</p>
          </div>
          <div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
            <h2 style="color: #333; margin-top: 0;">Password Reset</h2>
            <p style="color: #555; font-size: 15px; line-height: 1.6;">
              Hi <strong>${user.FirstName}</strong>, we received a request to reset your password.
            </p>
            <p style="color: #555; font-size: 15px; line-height: 1.6;">
              Click the button below to set a new password. This link expires in <strong>1 hour</strong>.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
                Reset Password
              </a>
            </div>
            <p style="color: #999; font-size: 12px; text-align: center;">
              If you didn't request this, you can safely ignore this email.<br>
              <a href="${resetUrl}" style="color: #667eea;">${resetUrl}</a>
            </p>
          </div>
        </div>
      `,
    });

    res.json({ message: 'If an account with that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// POST /api/auth/reset-password/:token - reset password via email token
router.post('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.purpose !== 'password-reset') {
      return res.status(400).json({ message: 'Invalid reset link.' });
    }

    const pool = await getPool();

    const result = await pool.request()
      .input('id', sql.Int, decoded.userId)
      .query('SELECT Id FROM Users WHERE Id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await pool.request()
      .input('id', sql.Int, decoded.userId)
      .input('passwordHash', sql.NVarChar, passwordHash)
      .query('UPDATE Users SET PasswordHash = @passwordHash WHERE Id = @id');

    res.json({ message: 'Password reset successfully. You can now sign in.' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(400).json({ message: 'Reset link has expired. Please request a new one.' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(400).json({ message: 'Invalid reset link.' });
    }
    console.error('Reset password error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
