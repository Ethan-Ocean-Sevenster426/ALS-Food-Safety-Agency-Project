const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sql, getPool } = require('../config/db');
const { sendEmail } = require('../services/emailService');

const crypto = require('crypto');

const router = express.Router();

const VALID_ROLES = ['Super Admin', 'Admin', 'Inspector', 'Company Admin', 'User'];

// In-memory OTP store: { email -> { code, expiresAt, verified } }
const otpStore = new Map();

// Clean up expired OTPs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [email, entry] of otpStore) {
    if (now > entry.expiresAt) otpStore.delete(email);
  }
}, 5 * 60 * 1000);

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password, role, inspectorProvince, clientRecordId } = req.body;

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
      .input('inspectorProvince', sql.NVarChar, assignedRole === 'Inspector' ? (inspectorProvince || null) : null)
      .query(
        'INSERT INTO Users (FirstName, LastName, Email, PasswordHash, Role, InspectorProvince, IsActive) VALUES (@firstName, @lastName, @email, @passwordHash, @role, @inspectorProvince, 1)'
      );

    // If a clientRecordId is provided for Company Admin or User, create an accepted invitation link
    if (clientRecordId && (assignedRole === 'Company Admin' || assignedRole === 'User')) {
      const token = crypto.randomBytes(32).toString('hex');
      await pool.request()
        .input('clientRecordId', sql.Int, parseInt(clientRecordId))
        .input('email', sql.NVarChar, email)
        .input('role', sql.NVarChar, assignedRole)
        .input('token', sql.NVarChar, token)
        .input('invitedBy', sql.NVarChar, 'Super Admin')
        .query(
          `INSERT INTO Invitations (ClientRecordId, Email, Role, Token, InvitedBy, Status, AcceptedAt)
           VALUES (@clientRecordId, @email, @role, @token, @invitedBy, 'Accepted', GETDATE())`
        );
    }

    res.status(201).json({ message: 'Account created successfully.' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

async function logLoginAttempt(pool, { userId, email, success, reason, req }) {
  try {
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().slice(0, 63);
    const ua = (req.headers['user-agent'] || '').toString().slice(0, 499);
    await pool.request()
      .input('userId', sql.Int, userId || null)
      .input('email', sql.NVarChar, email || '')
      .input('success', sql.Bit, success ? 1 : 0)
      .input('reason', sql.NVarChar, reason || null)
      .input('ip', sql.NVarChar, ip)
      .input('ua', sql.NVarChar, ua)
      .query(`INSERT INTO LoginLog (UserId, Email, Success, Reason, IPAddress, UserAgent)
              VALUES (@userId, @email, @success, @reason, @ip, @ua)`);
  } catch (e) {
    // Logging must never break authentication
    console.error('LoginLog insert failed:', e.message);
  }
}

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
                u.InspectorProvince, i.ClientRecordId
         FROM Users u
         LEFT JOIN Invitations i ON LOWER(u.Email) = LOWER(i.Email) AND i.Status = 'Accepted'
         WHERE LOWER(u.Email) = LOWER(@email)
         ORDER BY i.AcceptedAt DESC`
      );

    if (result.recordset.length === 0) {
      await logLoginAttempt(pool, { userId: null, email, success: false, reason: 'Unknown email', req });
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const user = result.recordset[0];

    if (user.IsActive === false || user.IsActive === 0) {
      // Check if this is a pending self-registration
      const pendingCheck = await pool.request()
        .input('pendingEmail', sql.NVarChar, user.Email)
        .query(
          `SELECT TOP 1 c.ApprovalStatus FROM Invitations i
           JOIN ConsolidatedMasterAbattoirDatabase c ON i.ClientRecordId = c.Id
           WHERE LOWER(i.Email) = LOWER(@pendingEmail) AND i.Status = 'Accepted'
           ORDER BY i.AcceptedAt DESC`
        );
      const isPending = pendingCheck.recordset.length > 0 && pendingCheck.recordset[0].ApprovalStatus === 'Pending';
      const msg = isPending
        ? 'Your company registration is pending approval. You will receive an email once approved.'
        : 'Your account has been deactivated. Please contact an administrator.';
      await logLoginAttempt(pool, { userId: user.Id, email: user.Email, success: false, reason: isPending ? 'Pending approval' : 'Account deactivated', req });
      return res.status(403).json({ message: msg });
    }

    const isMatch = await bcrypt.compare(password, user.PasswordHash);

    if (!isMatch) {
      await logLoginAttempt(pool, { userId: user.Id, email: user.Email, success: false, reason: 'Wrong password', req });
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: user.Id, email: user.Email, firstName: user.FirstName, role: user.Role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    await logLoginAttempt(pool, { userId: user.Id, email: user.Email, success: true, reason: null, req });

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
        inspectorProvince: user.InspectorProvince || null,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// GET /api/auth/login-log - list login attempts (paginated)
router.get('/login-log', async (req, res) => {
  try {
    const pool = await getPool();
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const successFilter = req.query.success; // 'true', 'false', or undefined

    const request = pool.request();
    const filters = [];
    if (search) {
      filters.push(`(l.Email LIKE @search OR u.FirstName LIKE @search OR u.LastName LIKE @search)`);
      request.input('search', sql.NVarChar, `%${search}%`);
    }
    if (successFilter === 'true')  filters.push('l.Success = 1');
    if (successFilter === 'false') filters.push('l.Success = 0');
    const whereSql = filters.length ? 'WHERE ' + filters.join(' AND ') : '';

    const countRes = await request.query(
      `SELECT COUNT(*) AS total
       FROM LoginLog l
       LEFT JOIN Users u ON l.UserId = u.Id
       ${whereSql}`
    );
    const total = countRes.recordset[0].total;

    const dataReq = pool.request();
    if (search) dataReq.input('search', sql.NVarChar, `%${search}%`);
    dataReq.input('offset', sql.Int, offset);
    dataReq.input('limit', sql.Int, limit);

    const dataRes = await dataReq.query(
      `SELECT l.Id, l.UserId, l.Email, l.Success, l.Reason, l.IPAddress, l.UserAgent, l.LoggedInAt,
              u.FirstName, u.LastName, u.Role
       FROM LoginLog l
       LEFT JOIN Users u ON l.UserId = u.Id
       ${whereSql}
       ORDER BY l.LoggedInAt DESC
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`
    );

    res.json({ data: dataRes.recordset, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('login-log fetch error:', err);
    res.status(500).json({ message: 'Failed to fetch login log.' });
  }
});

// GET /api/auth/users - list all users (admin only)
router.get('/users', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      `;WITH UserAllocations AS (
         SELECT u.Id, u.FirstName, u.LastName, u.Email, u.Role, u.CreatedAt, ISNULL(u.IsActive, 1) AS IsActive,
                u.InspectorProvince,
                c.BusinessName AS AllocatedClient,
                ROW_NUMBER() OVER (PARTITION BY u.Id ORDER BY i.AcceptedAt DESC) AS rn
         FROM Users u
         LEFT JOIN Invitations i ON LOWER(i.Email) = LOWER(u.Email) AND i.Status = 'Accepted'
         LEFT JOIN ConsolidatedMasterAbattoirDatabase c ON i.ClientRecordId = c.Id
       )
       SELECT Id, FirstName, LastName, Email, Role, CreatedAt, AllocatedClient, IsActive, InspectorProvince
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
  const { firstName, lastName, email, role, inspectorProvince } = req.body;

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

    const assignedRole = role || 'User';
    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('firstName', sql.NVarChar, firstName)
      .input('lastName', sql.NVarChar, lastName)
      .input('email', sql.NVarChar, email)
      .input('role', sql.NVarChar, assignedRole)
      .input('inspectorProvince', sql.NVarChar, assignedRole === 'Inspector' ? (inspectorProvince || null) : null)
      .query('UPDATE Users SET FirstName = @firstName, LastName = @lastName, Email = @email, Role = @role, InspectorProvince = @inspectorProvince WHERE Id = @id');

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

// POST /api/auth/send-otp - send a 6-digit OTP to verify email during registration
router.post('/send-otp', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required.' });
  }

  try {
    // Rate limit: don't allow resend within 60 seconds
    const prev = otpStore.get(email.toLowerCase());
    if (prev && Date.now() - (prev.createdAt || 0) < 60000) {
      return res.status(429).json({ message: 'Please wait before requesting a new code.' });
    }

    // Generate 6-digit code
    const code = crypto.randomInt(100000, 999999).toString();
    otpStore.set(email.toLowerCase(), {
      code,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      createdAt: Date.now(),
      verified: false,
    });

    // Send OTP email
    await sendEmail({
      to: email,
      subject: 'EPVS - Email Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #0E7C7B 0%, #065f5e 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: #fff; margin: 0; font-size: 28px;">EPVS</h1>
            <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Egg Production Verification System</p>
          </div>
          <div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
            <h2 style="color: #333; margin-top: 0;">Verify Your Email</h2>
            <p style="color: #555; font-size: 15px; line-height: 1.6;">
              Your verification code for company registration is:
            </p>
            <div style="text-align: center; margin: 24px 0;">
              <span style="display: inline-block; background: #f3f4f6; border: 2px solid #0E7C7B; border-radius: 12px; padding: 16px 32px; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #0E7C7B;">${code}</span>
            </div>
            <p style="color: #999; font-size: 13px; text-align: center;">
              This code expires in <strong>10 minutes</strong>. Do not share it with anyone.
            </p>
          </div>
        </div>
      `,
    });

    res.json({ message: 'Verification code sent to your email.' });
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ message: 'Failed to send verification code. Please try again.' });
  }
});

// POST /api/auth/verify-otp - verify the 6-digit OTP
router.post('/verify-otp', async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ message: 'Email and verification code are required.' });
  }

  const entry = otpStore.get(email.toLowerCase());

  if (!entry) {
    return res.status(400).json({ message: 'No verification code found. Please request a new one.' });
  }

  if (Date.now() > entry.expiresAt) {
    otpStore.delete(email.toLowerCase());
    return res.status(400).json({ message: 'Verification code has expired. Please request a new one.' });
  }

  if (entry.code !== code.toString().trim()) {
    return res.status(400).json({ message: 'Invalid verification code.' });
  }

  // Mark as verified and generate a token
  entry.verified = true;
  const otpToken = jwt.sign(
    { email: email.toLowerCase(), purpose: 'otp-verified' },
    process.env.JWT_SECRET,
    { expiresIn: '30m' }
  );

  res.json({ message: 'Email verified successfully.', otpToken });
});

// POST /api/auth/register-company - self-registration for companies
router.post('/register-company', async (req, res) => {
  const {
    firstName, lastName, email, password, otpToken,
    businessName, facilityProvince, companyRegNumber, physicalAddress, vatNumber,
    facilityType, town,
    abattoirOwnerName, abattoirOwnerCell, abattoirOwnerEmail,
    accountsContactName, accountsTelephone, accountsEmail,
    abattoirManagerName, abattoirManagerCell, abattoirManagerEmail
  } = req.body;

  if (!firstName || !lastName || !email || !password || !businessName) {
    return res.status(400).json({ message: 'First name, last name, email, password, and business name are required.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  }

  // Verify OTP token
  if (!otpToken) {
    return res.status(400).json({ message: 'Email verification is required.' });
  }
  try {
    const decoded = jwt.verify(otpToken, process.env.JWT_SECRET);
    if (decoded.purpose !== 'otp-verified' || decoded.email !== email.toLowerCase()) {
      return res.status(400).json({ message: 'Invalid email verification. Please verify your email again.' });
    }
  } catch (e) {
    return res.status(400).json({ message: 'Email verification expired. Please verify your email again.' });
  }

  try {
    const pool = await getPool();

    // Check if user already exists
    const existing = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT Id FROM Users WHERE LOWER(Email) = LOWER(@email)');
    if (existing.recordset.length > 0) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    // Create client_record with ApprovalStatus = 'Pending'
    const clientResult = await pool.request()
      .input('businessName', sql.NVarChar, businessName)
      .input('email', sql.NVarChar, email)
      .input('facilityProvince', sql.NVarChar, facilityProvince || '')
      .input('companyRegNumber', sql.NVarChar, companyRegNumber || '')
      .input('physicalAddress', sql.NVarChar, physicalAddress || '')
      .input('vatNumber', sql.NVarChar, vatNumber || '')
      .input('facilityType', sql.NVarChar, facilityType || '')
      .input('town', sql.NVarChar, town || '')
      .input('abattoirOwnerName', sql.NVarChar, abattoirOwnerName || '')
      .input('abattoirOwnerCell', sql.NVarChar, abattoirOwnerCell || '')
      .input('abattoirOwnerEmail', sql.NVarChar, abattoirOwnerEmail || '')
      .input('accountsContactName', sql.NVarChar, accountsContactName || '')
      .input('accountsTelephone', sql.NVarChar, accountsTelephone || '')
      .input('accountsEmail', sql.NVarChar, accountsEmail || '')
      .input('abattoirManagerName', sql.NVarChar, abattoirManagerName || '')
      .input('abattoirManagerCell', sql.NVarChar, abattoirManagerCell || '')
      .input('abattoirManagerEmail', sql.NVarChar, abattoirManagerEmail || '')
      .input('approvalStatus', sql.NVarChar, 'Pending')
      .query(
        `INSERT INTO ConsolidatedMasterAbattoirDatabase
         (BusinessName, Email, FacilityProvince, CompanyRegNumber, PhysicalAddress, VATNumber,
          FacilityType, Town,
          AbattoirOwnerName, AbattoirOwnerCell, AbattoirOwnerEmail,
          AccountsContactName, AccountsTelephone, AccountsEmail,
          AbattoirManagerName, AbattoirManagerCell, AbattoirManagerEmail,
          ApprovalStatus)
         OUTPUT INSERTED.Id
         VALUES (@businessName, @email, @facilityProvince, @companyRegNumber, @physicalAddress, @vatNumber,
                 @facilityType, @town,
                 @abattoirOwnerName, @abattoirOwnerCell, @abattoirOwnerEmail,
                 @accountsContactName, @accountsTelephone, @accountsEmail,
                 @abattoirManagerName, @abattoirManagerCell, @abattoirManagerEmail,
                 @approvalStatus)`
      );

    const clientRecordId = clientResult.recordset[0].Id;

    // Create user account with IsActive = FALSE (blocked until approved)
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    await pool.request()
      .input('firstName', sql.NVarChar, firstName)
      .input('lastName', sql.NVarChar, lastName)
      .input('email', sql.NVarChar, email)
      .input('passwordHash', sql.NVarChar, passwordHash)
      .input('role', sql.NVarChar, 'Company Admin')
      .query('INSERT INTO Users (FirstName, LastName, Email, PasswordHash, Role, IsActive) VALUES (@firstName, @lastName, @email, @passwordHash, @role, 0)');

    // Create an accepted invitation to link user to client_record
    const inviteToken = crypto.randomBytes(32).toString('hex');
    await pool.request()
      .input('clientRecordId', sql.Int, clientRecordId)
      .input('email', sql.NVarChar, email)
      .input('role', sql.NVarChar, 'Company Admin')
      .input('token', sql.NVarChar, inviteToken)
      .input('invitedBy', sql.NVarChar, 'Self-Registration')
      .query(
        `INSERT INTO Invitations (ClientRecordId, Email, Role, Token, InvitedBy, Status, AcceptedAt)
         VALUES (@clientRecordId, @email, @role, @token, @invitedBy, 'Accepted', GETDATE())`
      );

    // Audit log
    await pool.request()
      .input('recordId', sql.Int, clientRecordId)
      .input('fieldName', sql.NVarChar, '_SELF_REGISTERED')
      .input('newValue', sql.NVarChar, `Self-registered by ${firstName} ${lastName} (${email})`)
      .input('changedBy', sql.NVarChar, `${firstName} ${lastName}`)
      .query(
        `INSERT INTO ClientAuditLog (RecordId, FieldName, OldValue, NewValue, ChangedBy)
         VALUES (@recordId, @fieldName, '', @newValue, @changedBy)`
      );

    res.status(201).json({ message: 'Registration submitted. Your account is pending approval. You will receive an email once approved.' });
  } catch (err) {
    console.error('Self-registration error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
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

    const resetUrl = `https://egg-production-verification.fsa-pty.co.za/reset-password/${resetToken}`;

    await sendEmail({
      to: user.Email,
      subject: 'EPVS - Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #0E7C7B 0%, #065f5e 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
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
              <a href="${resetUrl}" style="display: inline-block; background-color: #0E7C7B; color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
                Reset Password
              </a>
            </div>
            <p style="color: #999; font-size: 12px; text-align: center;">
              If you didn't request this, you can safely ignore this email.<br>
              <a href="${resetUrl}" style="color: #0E7C7B;">${resetUrl}</a>
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
