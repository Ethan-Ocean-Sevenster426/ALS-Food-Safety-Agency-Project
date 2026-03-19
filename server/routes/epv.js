const express = require('express');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const { sql, getPool } = require('../config/db');
const { sendEmail } = require('../services/emailService');

const router = express.Router();

const LEVY_RATE = 0.018;

// Multer setup for POP uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads', 'pop')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `pop-${req.params.id}-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only PDF, PNG, and JPG files are allowed.'));
  },
});

// Generate unique reference number: EPV-YYYY-MM-XXXX
async function generateReferenceNumber(pool, month, year) {
  const prefix = `EPV-${year}-${String(month).padStart(2, '0')}`;
  const result = await pool.request()
    .input('prefix', sql.NVarChar, `${prefix}%`)
    .query(`SELECT COUNT(*) AS cnt FROM EggProductionVerifications WHERE ReferenceNumber LIKE @prefix`);
  const seq = (result.recordset[0].cnt || 0) + 1;
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

// All numeric fields that can be submitted
const NUMERIC_FIELDS = [
  'OpeningStock', 'GradedEggsPurchased', 'UngradedEggsPurchased',
  'MarketReturns', 'MachineLoss', 'SentToPulp', 'Destroyed',
  'SoldToTrade', 'Exported', 'SoldToStaff', 'SoldThroughFarmStall',
  'TransferredToOtherProducers', 'ActualClosingStock',
  'PulpOpeningStock', 'PulpPurchased', 'PulpConverted',
];

// All text fields that can be submitted
const TEXT_FIELDS = [
  'BusinessName', 'FacilityType', 'FacilityProvince', 'TradingName',
  'AuthorizedPersonName', 'PositionInCompany',
  'TelephoneNumber', 'CellPhoneNumber', 'EmailAddress',
];

const ALL_FIELDS = [...TEXT_FIELDS, ...NUMERIC_FIELDS];

function calculateTotals(data) {
  // A = Opening Stock
  const totalA = parseFloat(data.OpeningStock) || 0;

  // B = Purchases (Graded + Ungraded)
  const graded = parseFloat(data.GradedEggsPurchased) || 0;
  const ungraded = parseFloat(data.UngradedEggsPurchased) || 0;
  const totalB = graded + ungraded;

  // C = Deductions
  const marketReturns = parseFloat(data.MarketReturns) || 0;
  const machineLoss = parseFloat(data.MachineLoss) || 0;
  const sentToPulp = parseFloat(data.SentToPulp) || 0;
  const destroyed = parseFloat(data.Destroyed) || 0;
  const totalC = marketReturns + machineLoss + sentToPulp + destroyed;

  // D = Sales
  const soldToTrade = parseFloat(data.SoldToTrade) || 0;
  const exported = parseFloat(data.Exported) || 0;
  const soldToStaff = parseFloat(data.SoldToStaff) || 0;
  const soldThroughFarmStall = parseFloat(data.SoldThroughFarmStall) || 0;
  const totalD = soldToTrade + exported + soldToStaff + soldThroughFarmStall;
  const levyAmount = totalD * LEVY_RATE;

  // E = Transfers
  const totalE = parseFloat(data.TransferredToOtherProducers) || 0;

  // Closing Stock (Theoretical) = A + B - C - D - E
  const closingStock = totalA + totalB - totalC - totalD - totalE;

  // Actual Closing Stock (provided by producer)
  const actualClosingStock = parseFloat(data.ActualClosingStock) || 0;

  // (Loss)/Gain = Actual - Theoretical
  const lossGain = actualClosingStock - closingStock;

  return { TotalB: totalB, TotalC: totalC, TotalD: totalD, TotalE: totalE, LevyAmount: levyAmount, ClosingStock: closingStock, ActualClosingStock: actualClosingStock, LossGain: lossGain };
}

// POST /api/epv/send - Send EPV for a specific client (Super Admin / from Clients page)
router.post('/send', async (req, res) => {
  const { clientRecordId, sentBy } = req.body;

  if (!clientRecordId || !sentBy) {
    return res.status(400).json({ message: 'clientRecordId and sentBy are required.' });
  }

  try {
    const pool = await getPool();

    // Get client details
    const clientResult = await pool.request()
      .input('id', sql.Int, parseInt(clientRecordId))
      .query('SELECT * FROM ConsolidatedMasterAbattoirDatabase WHERE Id = @id');

    if (clientResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Client not found.' });
    }

    const client = clientResult.recordset[0];
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    // Check if EPV already exists for this month
    const existingResult = await pool.request()
      .input('clientRecordId', sql.Int, parseInt(clientRecordId))
      .input('month', sql.Int, month)
      .input('year', sql.Int, year)
      .query(
        `SELECT Id, Status FROM EggProductionVerifications
         WHERE ClientRecordId = @clientRecordId AND PeriodMonth = @month AND PeriodYear = @year`
      );

    if (existingResult.recordset.length > 0) {
      return res.status(409).json({
        message: `An EPV for ${year}-${String(month).padStart(2, '0')} already exists (${existingResult.recordset[0].Status}).`,
      });
    }

    // Get previous month's closing stock
    let prevClosingStock = 0;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevResult = await pool.request()
      .input('clientRecordId', sql.Int, parseInt(clientRecordId))
      .input('prevMonth', sql.Int, prevMonth)
      .input('prevYear', sql.Int, prevYear)
      .query(
        `SELECT ClosingStock FROM EggProductionVerifications
         WHERE ClientRecordId = @clientRecordId AND PeriodMonth = @prevMonth AND PeriodYear = @prevYear AND Status = 'Completed'`
      );
    if (prevResult.recordset.length > 0) {
      prevClosingStock = prevResult.recordset[0].ClosingStock || 0;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const referenceNumber = await generateReferenceNumber(pool, month, year);

    // Create the EPV record with pre-filled data from client
    await pool.request()
      .input('clientRecordId', sql.Int, parseInt(clientRecordId))
      .input('month', sql.Int, month)
      .input('year', sql.Int, year)
      .input('token', sql.NVarChar, token)
      .input('refNumber', sql.NVarChar, referenceNumber)
      .input('businessName', sql.NVarChar, client.BusinessName || '')
      .input('facilityType', sql.NVarChar, client.FacilityType || '')
      .input('email', sql.NVarChar, client.Email || '')
      .input('ownerName', sql.NVarChar, client.AbattoirOwnerName || '')
      .input('openingStock', sql.Decimal(18, 2), prevClosingStock)
      .query(
        `INSERT INTO EggProductionVerifications
         (ClientRecordId, PeriodMonth, PeriodYear, Token, ReferenceNumber, Status,
          BusinessName, FacilityType, EmailAddress, AuthorizedPersonName, OpeningStock)
         VALUES (@clientRecordId, @month, @year, @token, @refNumber, 'Pending',
                 @businessName, @facilityType, @email, @ownerName, @openingStock)`
      );

    // Build CC list from facility contact emails
    const ccEmails = [];
    if (client.AbattoirOwnerEmail && client.AbattoirOwnerEmail.includes('@')) {
      ccEmails.push(client.AbattoirOwnerEmail);
    }
    if (client.AccountsEmail && client.AccountsEmail.includes('@')) {
      ccEmails.push(client.AccountsEmail);
    }
    if (client.AbattoirManagerEmail && client.AbattoirManagerEmail.includes('@')) {
      ccEmails.push(client.AbattoirManagerEmail);
    }

    const formUrl = `http://localhost:3000/epv/${token}`;
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    await sendEmail({
      to: client.Email,
      cc: ccEmails.length > 0 ? ccEmails.join(', ') : undefined,
      subject: `EPVS - Egg Production Verification Due: ${monthNames[month - 1]} ${year}`,
      html: buildEPVEmail({
        businessName: client.BusinessName,
        month: monthNames[month - 1],
        year,
        formUrl,
        openingStock: prevClosingStock,
      }),
    });

    res.json({ message: `EPV sent to ${client.Email} for ${monthNames[month - 1]} ${year}.` });
  } catch (err) {
    console.error('EPV send error:', err);
    res.status(500).json({ message: 'Failed to send EPV.' });
  }
});

// POST /api/epv/create-manual - Company Admin/User creates an EPV for a specific month
router.post('/create-manual', async (req, res) => {
  const { clientRecordId, periodMonth, periodYear, createdBy } = req.body;

  if (!clientRecordId || !periodMonth || !periodYear || !createdBy) {
    return res.status(400).json({ message: 'clientRecordId, periodMonth, periodYear, and createdBy are required.' });
  }

  const month = parseInt(periodMonth);
  const year = parseInt(periodYear);

  if (month < 1 || month > 12) {
    return res.status(400).json({ message: 'Invalid month.' });
  }

  // Don't allow future months
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  if (year > currentYear || (year === currentYear && month > currentMonth)) {
    return res.status(400).json({ message: 'Cannot create a verification for a future month.' });
  }

  try {
    const pool = await getPool();

    // Check if EPV already exists for this month
    const existingResult = await pool.request()
      .input('clientRecordId', sql.Int, parseInt(clientRecordId))
      .input('month', sql.Int, month)
      .input('year', sql.Int, year)
      .query(
        `SELECT Id, Status FROM EggProductionVerifications
         WHERE ClientRecordId = @clientRecordId AND PeriodMonth = @month AND PeriodYear = @year`
      );

    if (existingResult.recordset.length > 0) {
      const existing = existingResult.recordset[0];
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      return res.status(409).json({
        message: `A verification for ${monthNames[month - 1]} ${year} already exists (${existing.Status}). Only one verification per month is allowed.`,
      });
    }

    // Get client details
    const clientResult = await pool.request()
      .input('id', sql.Int, parseInt(clientRecordId))
      .query('SELECT * FROM ConsolidatedMasterAbattoirDatabase WHERE Id = @id');

    if (clientResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Client not found.' });
    }

    const client = clientResult.recordset[0];

    // Get previous month's closing stock
    let prevClosingStock = 0;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevResult = await pool.request()
      .input('clientRecordId', sql.Int, parseInt(clientRecordId))
      .input('prevMonth', sql.Int, prevMonth)
      .input('prevYear', sql.Int, prevYear)
      .query(
        `SELECT ClosingStock FROM EggProductionVerifications
         WHERE ClientRecordId = @clientRecordId AND PeriodMonth = @prevMonth AND PeriodYear = @prevYear AND Status = 'Completed'`
      );
    if (prevResult.recordset.length > 0) {
      prevClosingStock = prevResult.recordset[0].ClosingStock || 0;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const referenceNumber = await generateReferenceNumber(pool, month, year);

    await pool.request()
      .input('clientRecordId', sql.Int, parseInt(clientRecordId))
      .input('month', sql.Int, month)
      .input('year', sql.Int, year)
      .input('token', sql.NVarChar, token)
      .input('refNumber', sql.NVarChar, referenceNumber)
      .input('businessName', sql.NVarChar, client.BusinessName || '')
      .input('facilityType', sql.NVarChar, client.FacilityType || '')
      .input('email', sql.NVarChar, client.Email || '')
      .input('ownerName', sql.NVarChar, client.AbattoirOwnerName || '')
      .input('openingStock', sql.Decimal(18, 2), prevClosingStock)
      .query(
        `INSERT INTO EggProductionVerifications
         (ClientRecordId, PeriodMonth, PeriodYear, Token, ReferenceNumber, Status,
          BusinessName, FacilityType, EmailAddress, AuthorizedPersonName, OpeningStock)
         VALUES (@clientRecordId, @month, @year, @token, @refNumber, 'Pending',
                 @businessName, @facilityType, @email, @ownerName, @openingStock)`
      );

    res.json({ message: 'Verification created.', token });
  } catch (err) {
    console.error('EPV create-manual error:', err);
    res.status(500).json({ message: 'Failed to create verification.' });
  }
});

// GET /api/epv/token/:token - Get EPV form by token (public, for email link)
router.get('/token/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('token', sql.NVarChar, token)
      .query(
        `SELECT e.*, c.ClientID, c.AccountCode, c.Town,
                c.AbattoirOwnerName, c.AbattoirOwnerCell, c.AbattoirOwnerEmail,
                c.AccountsContactName, c.AccountsTelephone, c.AccountsEmail,
                c.AbattoirManagerName, c.AbattoirManagerCell, c.AbattoirManagerEmail
         FROM EggProductionVerifications e
         JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
         WHERE e.Token = @token`
      );

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Verification form not found.' });
    }

    res.json({ verification: result.recordset[0] });
  } catch (err) {
    console.error('EPV fetch error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// PUT /api/epv/token/:token/submit - Submit/complete EPV form
router.put('/token/:token/submit', async (req, res) => {
  const { token } = req.params;
  const { data, completedBy } = req.body;

  if (!data || !completedBy) {
    return res.status(400).json({ message: 'data and completedBy are required.' });
  }

  try {
    const pool = await getPool();

    const existing = await pool.request()
      .input('token', sql.NVarChar, token)
      .query('SELECT * FROM EggProductionVerifications WHERE Token = @token');

    if (existing.recordset.length === 0) {
      return res.status(404).json({ message: 'Verification form not found.' });
    }

    const epv = existing.recordset[0];

    // Reject if already completed (company users must log a support ticket for changes)
    if (epv.Status === 'Completed') {
      return res.status(409).json({ message: 'This verification has already been submitted. If you need to make changes, please log a support ticket.' });
    }

    const totals = calculateTotals(data);

    // Build UPDATE query
    const updateRequest = pool.request();
    updateRequest.input('token', sql.NVarChar, token);
    updateRequest.input('completedBy', sql.NVarChar, completedBy);
    updateRequest.input('totalB', sql.Decimal(18, 2), totals.TotalB);
    updateRequest.input('totalC', sql.Decimal(18, 2), totals.TotalC);
    updateRequest.input('totalD', sql.Decimal(18, 2), totals.TotalD);
    updateRequest.input('totalE', sql.Decimal(18, 2), totals.TotalE);
    updateRequest.input('levyAmount', sql.Decimal(18, 4), totals.LevyAmount);
    updateRequest.input('closingStock', sql.Decimal(18, 2), totals.ClosingStock);
    updateRequest.input('actualClosingStock', sql.Decimal(18, 2), totals.ActualClosingStock);
    updateRequest.input('lossGain', sql.Decimal(18, 2), totals.LossGain);

    const setParts = [
      "Status = 'Completed'",
      'CompletedAt = GETDATE()',
      'CompletedBy = @completedBy',
      'TotalB = @totalB',
      'TotalC = @totalC',
      'TotalD = @totalD',
      'TotalE = @totalE',
      'LevyAmount = @levyAmount',
      'ClosingStock = @closingStock',
      'ActualClosingStock = @actualClosingStock',
      'LossGain = @lossGain',
    ];

    TEXT_FIELDS.forEach((field, i) => {
      const paramName = `text${i}`;
      updateRequest.input(paramName, sql.NVarChar, data[field] || '');
      setParts.push(`${field} = @${paramName}`);
    });

    NUMERIC_FIELDS.forEach((field, i) => {
      const paramName = `num${i}`;
      updateRequest.input(paramName, sql.Int, parseInt(data[field]) || 0);
      setParts.push(`${field} = @${paramName}`);
    });

    await updateRequest.query(
      `UPDATE EggProductionVerifications SET ${setParts.join(', ')} WHERE Token = @token`
    );

    // Log audit entries for the completion
    const auditRequest = pool.request();
    auditRequest.input('verificationId', sql.Int, epv.Id);
    auditRequest.input('changedBy', sql.NVarChar, completedBy);
    auditRequest.input('fieldName', sql.NVarChar, '_SUBMITTED');
    auditRequest.input('newValue', sql.NVarChar, `Form submitted by ${completedBy}`);
    await auditRequest.query(
      `INSERT INTO EPVAuditLog (VerificationId, FieldName, NewValue, ChangedBy)
       VALUES (@verificationId, @fieldName, @newValue, @changedBy)`
    );

    res.json({ message: 'Verification submitted successfully.', totals });
  } catch (err) {
    console.error('EPV submit error:', err);
    res.status(500).json({ message: 'Failed to submit verification.' });
  }
});

// PUT /api/epv/:id/edit - Edit a completed EPV (Company Admin only, with audit)
router.put('/:id/edit', async (req, res) => {
  const { id } = req.params;
  const { data, editedBy } = req.body;

  if (!data || !editedBy) {
    return res.status(400).json({ message: 'data and editedBy are required.' });
  }

  try {
    const pool = await getPool();

    const existing = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT * FROM EggProductionVerifications WHERE Id = @id');

    if (existing.recordset.length === 0) {
      return res.status(404).json({ message: 'Verification not found.' });
    }

    const epv = existing.recordset[0];
    const totals = calculateTotals(data);

    // Build audit entries for changed fields
    const auditEntries = [];
    for (const field of ALL_FIELDS) {
      const oldVal = String(epv[field] || '');
      const newVal = String(data[field] || '');
      if (oldVal !== newVal) {
        auditEntries.push({ field, oldValue: oldVal, newValue: newVal });
      }
    }

    // Also check calculated fields
    const calcFields = { TotalB: totals.TotalB, TotalC: totals.TotalC, TotalD: totals.TotalD, LevyAmount: totals.LevyAmount, ClosingStock: totals.ClosingStock };
    for (const [field, newVal] of Object.entries(calcFields)) {
      const oldVal = String(epv[field] || '');
      if (oldVal !== String(newVal)) {
        auditEntries.push({ field, oldValue: oldVal, newValue: String(newVal) });
      }
    }

    if (auditEntries.length === 0) {
      return res.json({ message: 'No changes detected.' });
    }

    // Update the record
    const updateRequest = pool.request();
    updateRequest.input('id', sql.Int, parseInt(id));
    updateRequest.input('totalB', sql.Decimal(18, 2), totals.TotalB);
    updateRequest.input('totalC', sql.Decimal(18, 2), totals.TotalC);
    updateRequest.input('totalD', sql.Decimal(18, 2), totals.TotalD);
    updateRequest.input('totalE', sql.Decimal(18, 2), totals.TotalE);
    updateRequest.input('levyAmount', sql.Decimal(18, 4), totals.LevyAmount);
    updateRequest.input('closingStock', sql.Decimal(18, 2), totals.ClosingStock);
    updateRequest.input('actualClosingStock', sql.Decimal(18, 2), totals.ActualClosingStock);
    updateRequest.input('lossGain', sql.Decimal(18, 2), totals.LossGain);

    const setParts = [
      'TotalB = @totalB', 'TotalC = @totalC', 'TotalD = @totalD', 'TotalE = @totalE',
      'LevyAmount = @levyAmount', 'ClosingStock = @closingStock',
      'ActualClosingStock = @actualClosingStock', 'LossGain = @lossGain',
    ];

    TEXT_FIELDS.forEach((field, i) => {
      const paramName = `text${i}`;
      updateRequest.input(paramName, sql.NVarChar, data[field] || '');
      setParts.push(`${field} = @${paramName}`);
    });

    NUMERIC_FIELDS.forEach((field, i) => {
      const paramName = `num${i}`;
      updateRequest.input(paramName, sql.Int, parseInt(data[field]) || 0);
      setParts.push(`${field} = @${paramName}`);
    });

    await updateRequest.query(
      `UPDATE EggProductionVerifications SET ${setParts.join(', ')} WHERE Id = @id`
    );

    // Log all audit entries
    for (const entry of auditEntries) {
      await pool.request()
        .input('verificationId', sql.Int, parseInt(id))
        .input('fieldName', sql.NVarChar, entry.field)
        .input('oldValue', sql.NVarChar, entry.oldValue)
        .input('newValue', sql.NVarChar, entry.newValue)
        .input('changedBy', sql.NVarChar, editedBy)
        .query(
          `INSERT INTO EPVAuditLog (VerificationId, FieldName, OldValue, NewValue, ChangedBy)
           VALUES (@verificationId, @fieldName, @oldValue, @newValue, @changedBy)`
        );
    }

    res.json({ message: `${auditEntries.length} field(s) updated.`, totals });
  } catch (err) {
    console.error('EPV edit error:', err);
    res.status(500).json({ message: 'Failed to update verification.' });
  }
});

// GET /api/epv/company/:clientRecordId - List all EPVs for a company
router.get('/company/:clientRecordId', async (req, res) => {
  const { clientRecordId } = req.params;

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('clientRecordId', sql.Int, parseInt(clientRecordId))
      .query(
        `SELECT Id, ClientRecordId, PeriodMonth, PeriodYear, Status, SentAt, CompletedAt, CompletedBy, Token,
                ReferenceNumber, POPFilePath, POPUploadedAt, POPUploadedBy, IsReconciled, ReconciledBy, ReconciledAt
         FROM EggProductionVerifications
         WHERE ClientRecordId = @clientRecordId
         ORDER BY PeriodYear DESC, PeriodMonth DESC`
      );

    res.json({ verifications: result.recordset });
  } catch (err) {
    console.error('EPV list error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// GET /api/epv/:id - Get a specific EPV by ID (for editing)
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT * FROM EggProductionVerifications WHERE Id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Verification not found.' });
    }

    res.json({ verification: result.recordset[0] });
  } catch (err) {
    console.error('EPV fetch error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// GET /api/epv/:id/audit-log - Get audit log for a specific EPV
router.get('/:id/audit-log', async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('verificationId', sql.Int, parseInt(id))
      .query(
        `SELECT Id, VerificationId, FieldName, OldValue, NewValue, ChangedBy, ChangedAt
         FROM EPVAuditLog
         WHERE VerificationId = @verificationId
         ORDER BY ChangedAt DESC`
      );

    res.json({ auditLog: result.recordset });
  } catch (err) {
    console.error('EPV audit log error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// POST /api/epv/:id/upload-pop - Upload Proof of Payment
router.post('/:id/upload-pop', upload.single('pop'), async (req, res) => {
  const { id } = req.params;
  const { uploadedBy } = req.body;

  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  try {
    const pool = await getPool();

    // Verify EPV exists
    const existing = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT Id, IsReconciled FROM EggProductionVerifications WHERE Id = @id');

    if (existing.recordset.length === 0) {
      return res.status(404).json({ message: 'Verification not found.' });
    }

    if (existing.recordset[0].IsReconciled) {
      return res.status(400).json({ message: 'This EPV has already been reconciled. Cannot upload a new POP.' });
    }

    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('filePath', sql.NVarChar, req.file.filename)
      .input('uploadedBy', sql.NVarChar, uploadedBy || 'Unknown')
      .query(
        `UPDATE EggProductionVerifications
         SET POPFilePath = @filePath, POPUploadedAt = GETDATE(), POPUploadedBy = @uploadedBy
         WHERE Id = @id`
      );

    res.json({ message: 'Proof of Payment uploaded successfully.', filename: req.file.filename });
  } catch (err) {
    console.error('POP upload error:', err);
    res.status(500).json({ message: 'Failed to upload POP.' });
  }
});

// GET /api/epv/:id/pop - Serve POP file
router.get('/:id/pop', async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT POPFilePath FROM EggProductionVerifications WHERE Id = @id');

    if (result.recordset.length === 0 || !result.recordset[0].POPFilePath) {
      return res.status(404).json({ message: 'No POP file found.' });
    }

    const filePath = path.join(__dirname, '..', 'uploads', 'pop', result.recordset[0].POPFilePath);
    res.sendFile(filePath);
  } catch (err) {
    console.error('POP serve error:', err);
    res.status(500).json({ message: 'Failed to retrieve POP.' });
  }
});

// PUT /api/epv/:id/reconcile - Toggle reconciled status (Admin/Super Admin only)
router.put('/:id/reconcile', async (req, res) => {
  const { id } = req.params;
  const { reconciled, reconciledBy } = req.body;

  try {
    const pool = await getPool();

    const existing = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT Id, POPFilePath FROM EggProductionVerifications WHERE Id = @id');

    if (existing.recordset.length === 0) {
      return res.status(404).json({ message: 'Verification not found.' });
    }

    if (reconciled && !existing.recordset[0].POPFilePath) {
      return res.status(400).json({ message: 'Cannot reconcile without a Proof of Payment uploaded.' });
    }

    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('reconciled', sql.Bit, reconciled ? 1 : 0)
      .input('reconciledBy', sql.NVarChar, reconciled ? (reconciledBy || 'Unknown') : null)
      .query(
        `UPDATE EggProductionVerifications
         SET IsReconciled = @reconciled,
             ReconciledBy = ${reconciled ? '@reconciledBy' : 'NULL'},
             ReconciledAt = ${reconciled ? 'GETDATE()' : 'NULL'}
         WHERE Id = @id`
      );

    res.json({ message: reconciled ? 'EPV marked as reconciled.' : 'Reconciliation removed.' });
  } catch (err) {
    console.error('Reconcile error:', err);
    res.status(500).json({ message: 'Failed to update reconciliation.' });
  }
});

// DELETE /api/epv/:id/pop - Delete POP file (Admin/Super Admin only)
router.delete('/:id/pop', async (req, res) => {
  const { id } = req.params;
  const fs = require('fs');

  try {
    const pool = await getPool();

    const existing = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT Id, POPFilePath, IsReconciled FROM EggProductionVerifications WHERE Id = @id');

    if (existing.recordset.length === 0) {
      return res.status(404).json({ message: 'Verification not found.' });
    }

    const epv = existing.recordset[0];

    if (!epv.POPFilePath) {
      return res.status(400).json({ message: 'No POP file to delete.' });
    }

    // Delete the file from disk
    const filePath = path.join(__dirname, '..', 'uploads', 'pop', epv.POPFilePath);
    try { fs.unlinkSync(filePath); } catch (e) { /* file may already be gone */ }

    // Clear POP and reconcile fields in DB
    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query(
        `UPDATE EggProductionVerifications
         SET POPFilePath = NULL, POPUploadedAt = NULL, POPUploadedBy = NULL,
             IsReconciled = 0, ReconciledBy = NULL, ReconciledAt = NULL
         WHERE Id = @id`
      );

    res.json({ message: 'POP deleted successfully.' });
  } catch (err) {
    console.error('POP delete error:', err);
    res.status(500).json({ message: 'Failed to delete POP.' });
  }
});

// Helper: build EPV email HTML
function buildEPVEmail({ businessName, month, year, formUrl, openingStock }) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #fff; margin: 0; font-size: 28px;">EPVS</h1>
        <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Egg Production Verification System</p>
      </div>
      <div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <h2 style="color: #333; margin-top: 0;">Egg Production Verification Due</h2>
        <p style="color: #555; font-size: 15px; line-height: 1.6;">
          The monthly Egg Production Verification for <strong>${businessName}</strong> is due for
          <strong style="color: #4f46e5;">${month} ${year}</strong>.
        </p>
        ${openingStock > 0 ? `
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; margin: 16px 0;">
          <p style="margin: 0; color: #15803d; font-size: 14px;">
            <strong>Opening Stock:</strong> ${openingStock.toLocaleString()} (carried over from previous month)
          </p>
        </div>
        ` : ''}
        <p style="color: #555; font-size: 15px; line-height: 1.6;">
          Please click the button below to complete the verification form:
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${formUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
            Complete Verification
          </a>
        </div>
        <p style="color: #999; font-size: 12px; text-align: center;">
          If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${formUrl}" style="color: #667eea;">${formUrl}</a>
        </p>
      </div>
      <p style="color: #aaa; font-size: 11px; text-align: center; margin-top: 20px;">
        This email was sent by the EPVS system. If you did not expect this email, please contact your administrator.
      </p>
    </div>
  `;
}

module.exports = router;
