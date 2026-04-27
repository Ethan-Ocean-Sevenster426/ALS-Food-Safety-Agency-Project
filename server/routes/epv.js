const express = require('express');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const { sql, getPool } = require('../config/db');
const { sendEmail, sendEmailToEach } = require('../services/emailService');

const router = express.Router();

const LEVY_RATE = 0.018;

// Helper: log to ClientAuditLog for company-level change log
async function logCompanyAudit(pool, recordId, fieldName, oldValue, newValue, changedBy, userRole) {
  // Ensure UserRole column exists
  await pool.request().query(
    `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ClientAuditLog') AND name = 'UserRole')
     BEGIN ALTER TABLE ClientAuditLog ADD UserRole NVARCHAR(50) NULL END`
  );
  await pool.request()
    .input('recordId', sql.Int, recordId)
    .input('fieldName', sql.NVarChar, fieldName)
    .input('oldValue', sql.NVarChar, oldValue || null)
    .input('newValue', sql.NVarChar, newValue || null)
    .input('changedBy', sql.NVarChar, changedBy)
    .input('userRole', sql.NVarChar, userRole || null)
    .query(
      `INSERT INTO ClientAuditLog (RecordId, FieldName, OldValue, NewValue, ChangedBy, UserRole)
       VALUES (@recordId, @fieldName, @oldValue, @newValue, @changedBy, @userRole)`
    );
}

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

// Multer setup for purchase attachments (egg/pulp purchase proofs).
// 15MB limit; PDF + common image formats only.
const purchaseDir = path.join(__dirname, '..', 'uploads', 'purchases');
require('fs').mkdirSync(purchaseDir, { recursive: true });
const purchaseStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, purchaseDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    cb(null, `pur-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}${ext}`);
  },
});
const purchaseUpload = multer({
  storage: purchaseStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
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
  'MarketReturns', 'MachineLoss', 'SentToPulp', 'Destroyed', 'Exported',
  'SoldToTrade', 'SoldToStaff', 'SoldThroughFarmStall',
  'TransferredToOtherProducers',
  'PulpOpeningStock', 'PulpPurchased', 'PulpConverted',
  'PulpSoldToTrade', 'PulpSoldToProducers', 'PulpConversionLoss',
];

// All text fields that can be submitted
const TEXT_FIELDS = [
  'BusinessName', 'FacilityType', 'FacilityProvince', 'TradingName',
  'AuthorizedPersonName', 'PositionInCompany',
  'TelephoneNumber', 'CellPhoneNumber', 'EmailAddress',
  'VarianceReason',
  'EggPurchaseComment', 'PulpPurchaseComment',
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
  const exported = parseFloat(data.Exported) || 0;
  const totalC = marketReturns + machineLoss + sentToPulp + destroyed + exported;

  // D = Sales
  const soldToTrade = parseFloat(data.SoldToTrade) || 0;
  const soldToStaff = parseFloat(data.SoldToStaff) || 0;
  const soldThroughFarmStall = parseFloat(data.SoldThroughFarmStall) || 0;
  const totalD = soldToTrade + soldToStaff + soldThroughFarmStall;
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

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Period currently expected when prompting: previous calendar month.
function previousMonthPeriod(now = new Date()) {
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { month: prev.getMonth() + 1, year: prev.getFullYear() };
}

// Shared core: create an EPV for the given period and email the facility.
// Used by both POST /send (manual) and the monthly scheduler.
async function sendEPVForFacility({ pool, client, periodMonth, periodYear, sentBy, userRole }) {
  const month = parseInt(periodMonth);
  const year = parseInt(periodYear);
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  const existing = await pool.request()
    .input('crid', sql.Int, client.Id)
    .input('month', sql.Int, month)
    .input('year', sql.Int, year)
    .query(
      `SELECT Id, Status FROM EggProductionVerifications
       WHERE ClientRecordId = @crid AND PeriodMonth = @month AND PeriodYear = @year
       AND (EPVType = 'Client' OR EPVType IS NULL)`
    );
  if (existing.recordset.length > 0) {
    return { ok: true, alreadyExists: true, status: existing.recordset[0].Status, monthLabel };
  }

  // Carry forward closing stock from the prior period
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  let prevClosingStock = 0;
  const prevResult = await pool.request()
    .input('crid', sql.Int, client.Id)
    .input('pm', sql.Int, prevMonth)
    .input('py', sql.Int, prevYear)
    .query(
      `SELECT ClosingStock FROM EggProductionVerifications
       WHERE ClientRecordId = @crid AND PeriodMonth = @pm AND PeriodYear = @py AND Status = 'Completed'`
    );
  if (prevResult.recordset.length > 0) {
    prevClosingStock = prevResult.recordset[0].ClosingStock || 0;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const referenceNumber = await generateReferenceNumber(pool, month, year);

  await pool.request()
    .input('crid', sql.Int, client.Id)
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
       VALUES (@crid, @month, @year, @token, @refNumber, 'Pending',
               @businessName, @facilityType, @email, @ownerName, @openingStock)`
    );

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const allEmails = [client.Email, client.AbattoirOwnerEmail, client.AccountsEmail, client.AbattoirManagerEmail, client.ManualEmail]
    .filter(e => e && String(e).trim() && emailRegex.test(String(e).trim()));
  const uniqueEmails = [...new Set(allEmails.map(e => String(e).trim().toLowerCase()))];

  const formUrl = `http://localhost:3000/epv/${token}`;
  const emailSubject = `EPVS - Egg Production Verification Due: ${monthLabel}`;
  const emailHtml = buildEPVEmail({
    businessName: client.BusinessName,
    month: MONTH_NAMES[month - 1],
    year,
    formUrl,
    openingStock: prevClosingStock,
  });

  const { succeeded, failed } = await sendEmailToEach({
    recipients: uniqueEmails,
    subject: emailSubject,
    html: emailHtml,
  });

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='EmailSendLog' AND xtype='U')
    BEGIN
      CREATE TABLE EmailSendLog (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        ClientRecordId INT NOT NULL,
        EmailAddress NVARCHAR(255) NOT NULL,
        EmailType NVARCHAR(50) NOT NULL,
        Subject NVARCHAR(500) NULL,
        Status NVARCHAR(20) NOT NULL,
        ErrorMessage NVARCHAR(MAX) NULL,
        SentAt DATETIME DEFAULT GETDATE(),
        SentBy NVARCHAR(255) NULL
      )
    END
  `);
  const logSend = (addr, status) => pool.request()
    .input('crid', sql.Int, client.Id)
    .input('addr', sql.NVarChar, addr)
    .input('type', sql.NVarChar, 'EPV')
    .input('subj', sql.NVarChar, emailSubject)
    .input('status', sql.NVarChar, status)
    .input('by', sql.NVarChar, sentBy)
    .query(`INSERT INTO EmailSendLog (ClientRecordId, EmailAddress, EmailType, Subject, Status, SentBy)
            VALUES (@crid, @addr, @type, @subj, @status, @by)`);
  for (const e of succeeded) await logSend(e, 'Sent');
  for (const e of failed)    await logSend(e, 'Failed');

  if (succeeded.length === 0) {
    return { ok: false, alreadyExists: false, error: 'All emails failed to send.', succeeded, failed, referenceNumber, monthLabel };
  }

  await pool.request()
    .input('clientId', sql.Int, client.Id)
    .query(`UPDATE ConsolidatedMasterAbattoirDatabase SET EPVCycleStatus = 'On EPV Cycle' WHERE Id = @clientId`);

  await logCompanyAudit(pool, client.Id, 'EPV Sent', null, `${referenceNumber} for ${monthLabel}`, sentBy, userRole);

  return { ok: true, alreadyExists: false, succeeded, failed, referenceNumber, monthLabel };
}

// POST /api/epv/send - Send EPV for a specific client (Super Admin / from Clients page)
router.post('/send', async (req, res) => {
  const { clientRecordId, sentBy } = req.body;

  if (!clientRecordId || !sentBy) {
    return res.status(400).json({ message: 'clientRecordId and sentBy are required.' });
  }

  try {
    const pool = await getPool();

    const clientResult = await pool.request()
      .input('id', sql.Int, parseInt(clientRecordId))
      .query('SELECT * FROM ConsolidatedMasterAbattoirDatabase WHERE Id = @id');

    if (clientResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Client not found.' });
    }

    const client = clientResult.recordset[0];
    const { month, year } = previousMonthPeriod();

    const result = await sendEPVForFacility({
      pool, client,
      periodMonth: month, periodYear: year,
      sentBy, userRole: req.body.userRole,
    });

    if (result.alreadyExists) {
      return res.status(409).json({
        message: `An EPV for ${result.monthLabel} already exists (${result.status}).`,
      });
    }
    if (!result.ok) {
      return res.status(500).json({ message: result.error || 'Failed to send EPV.' });
    }

    res.json({ message: `EPV sent to ${client.Email} for ${result.monthLabel}.` });
  } catch (err) {
    console.error('EPV send error:', err);
    res.status(500).json({ message: 'Failed to send EPV.' });
  }
});

// POST /api/epv/:id/resend - Re-email an existing EPV (no new record created).
// Use case: the client says they never received the original email.
router.post('/:id/resend', async (req, res) => {
  const { id } = req.params;
  const { resentBy } = req.body || {};
  if (!resentBy) {
    return res.status(400).json({ message: 'resentBy is required.' });
  }
  try {
    const pool = await getPool();
    const epvResult = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query(`SELECT * FROM EggProductionVerifications WHERE Id = @id`);
    if (epvResult.recordset.length === 0) {
      return res.status(404).json({ message: 'EPV not found.' });
    }
    const epv = epvResult.recordset[0];
    if (epv.EPVType === 'Inspector') {
      return res.status(400).json({ message: 'Inspector EPVs cannot be resent.' });
    }

    const clientResult = await pool.request()
      .input('cid', sql.Int, epv.ClientRecordId)
      .query('SELECT * FROM ConsolidatedMasterAbattoirDatabase WHERE Id = @cid');
    if (clientResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Linked facility not found.' });
    }
    const client = clientResult.recordset[0];

    const monthLabel = `${MONTH_NAMES[(epv.PeriodMonth || 1) - 1]} ${epv.PeriodYear}`;
    const formUrl = `http://localhost:3000/epv/${epv.Token}`;
    const emailSubject = `EPVS - Egg Production Verification Reminder: ${monthLabel}`;
    const emailHtml = buildEPVEmail({
      businessName: client.BusinessName,
      month: MONTH_NAMES[(epv.PeriodMonth || 1) - 1],
      year: epv.PeriodYear,
      formUrl,
      openingStock: parseFloat(epv.OpeningStock) || 0,
    });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const allEmails = [client.Email, client.AbattoirOwnerEmail, client.AccountsEmail, client.AbattoirManagerEmail, client.ManualEmail]
      .filter(e => e && String(e).trim() && emailRegex.test(String(e).trim()));
    const uniqueEmails = [...new Set(allEmails.map(e => String(e).trim().toLowerCase()))];
    if (uniqueEmails.length === 0) {
      return res.status(400).json({ message: 'No valid email addresses on file for this facility.' });
    }

    const { succeeded, failed } = await sendEmailToEach({
      recipients: uniqueEmails,
      subject: emailSubject,
      html: emailHtml,
    });

    const logSend = (addr, status) => pool.request()
      .input('crid', sql.Int, client.Id)
      .input('addr', sql.NVarChar, addr)
      .input('type', sql.NVarChar, 'EPV-Resend')
      .input('subj', sql.NVarChar, emailSubject)
      .input('status', sql.NVarChar, status)
      .input('by', sql.NVarChar, resentBy)
      .query(`INSERT INTO EmailSendLog (ClientRecordId, EmailAddress, EmailType, Subject, Status, SentBy)
              VALUES (@crid, @addr, @type, @subj, @status, @by)`);
    for (const e of succeeded) await logSend(e, 'Sent');
    for (const e of failed)    await logSend(e, 'Failed');

    if (succeeded.length === 0) {
      return res.status(500).json({ message: 'All resend attempts failed.' });
    }

    await logCompanyAudit(pool, client.Id, 'EPV Resent', null,
      `${epv.ReferenceNumber || ''} for ${monthLabel} → ${succeeded.length} recipient(s)`,
      resentBy, req.body.userRole);

    res.json({
      message: `Reminder resent to ${succeeded.length} recipient${succeeded.length === 1 ? '' : 's'}${failed.length ? ` (${failed.length} failed)` : ''}.`,
      succeeded, failed,
    });
  } catch (err) {
    console.error('EPV resend error:', err);
    res.status(500).json({ message: 'Failed to resend EPV.' });
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

  // Verifications may only be captured for months that have ended.
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  if (year > currentYear || (year === currentYear && month >= currentMonth)) {
    return res.status(400).json({ message: 'Verifications may only be captured for the previous month or earlier — the current month is not yet complete.' });
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
         WHERE ClientRecordId = @clientRecordId AND PeriodMonth = @month AND PeriodYear = @year
         AND (EPVType = 'Client' OR EPVType IS NULL)`
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
        `SELECT e.*, c.AccountCode, c.Town, c.PhysicalAddress,
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

    const verification = result.recordset[0];
    const attachments = (await pool.request()
      .input('vid', sql.Int, verification.Id)
      .query(`SELECT Id, Category, FileName, OriginalName, FileSize, MimeType, UploadedAt, UploadedBy
              FROM EPVAttachments WHERE VerificationId = @vid ORDER BY UploadedAt DESC`)).recordset;

    res.json({ verification, attachments });
  } catch (err) {
    console.error('EPV fetch error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// POST /api/epv/token/:token/attachment?category=egg|pulp - upload purchase attachment
router.post('/token/:token/attachment', purchaseUpload.single('file'), async (req, res) => {
  const { token } = req.params;
  const category = (req.query.category || '').toLowerCase();
  const uploadedBy = (req.body && req.body.uploadedBy) || 'Unknown';

  if (!['egg', 'pulp'].includes(category)) {
    return res.status(400).json({ message: 'category must be "egg" or "pulp".' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  try {
    const pool = await getPool();
    const epv = (await pool.request()
      .input('token', sql.NVarChar, token)
      .query('SELECT Id FROM EggProductionVerifications WHERE Token = @token')).recordset[0];
    if (!epv) {
      // remove orphan file
      try { require('fs').unlinkSync(req.file.path); } catch (_) {}
      return res.status(404).json({ message: 'Verification not found.' });
    }

    const inserted = await pool.request()
      .input('vid', sql.Int, epv.Id)
      .input('cat', sql.NVarChar, category === 'egg' ? 'EggPurchase' : 'PulpPurchase')
      .input('fn', sql.NVarChar, req.file.filename)
      .input('orig', sql.NVarChar, req.file.originalname)
      .input('size', sql.Int, req.file.size)
      .input('mime', sql.NVarChar, req.file.mimetype)
      .input('by', sql.NVarChar, uploadedBy)
      .query(`INSERT INTO EPVAttachments (VerificationId, Category, FileName, OriginalName, FileSize, MimeType, UploadedBy)
              OUTPUT INSERTED.Id, INSERTED.Category, INSERTED.FileName, INSERTED.OriginalName, INSERTED.FileSize, INSERTED.MimeType, INSERTED.UploadedAt, INSERTED.UploadedBy
              VALUES (@vid, @cat, @fn, @orig, @size, @mime, @by)`);
    res.status(201).json({ attachment: inserted.recordset[0] });
  } catch (err) {
    console.error('Purchase attachment upload error:', err);
    try { require('fs').unlinkSync(req.file.path); } catch (_) {}
    res.status(500).json({ message: 'Failed to upload attachment.' });
  }
});

// GET /api/epv/attachment/:id - download/view a purchase attachment
router.get('/attachment/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await getPool();
    const r = (await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT FileName, OriginalName, MimeType FROM EPVAttachments WHERE Id = @id')).recordset[0];
    if (!r) return res.status(404).json({ message: 'Attachment not found.' });

    const filePath = path.join(purchaseDir, r.FileName);
    if (!require('fs').existsSync(filePath)) return res.status(404).json({ message: 'File missing on disk.' });

    res.setHeader('Content-Type', r.MimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${r.OriginalName}"`);
    res.sendFile(filePath);
  } catch (err) {
    console.error('Attachment download error:', err);
    res.status(500).json({ message: 'Failed to fetch attachment.' });
  }
});

// DELETE /api/epv/attachment/:id - remove a purchase attachment
router.delete('/attachment/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await getPool();
    const r = (await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT FileName FROM EPVAttachments WHERE Id = @id')).recordset[0];
    if (!r) return res.status(404).json({ message: 'Attachment not found.' });

    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('DELETE FROM EPVAttachments WHERE Id = @id');
    try { require('fs').unlinkSync(path.join(purchaseDir, r.FileName)); } catch (_) {}
    res.json({ message: 'Attachment deleted.' });
  } catch (err) {
    console.error('Attachment delete error:', err);
    res.status(500).json({ message: 'Failed to delete attachment.' });
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

    // Ensure verification columns exist
    for (const col of [
      { name: 'IsVerified', type: 'BIT NOT NULL DEFAULT 0' },
      { name: 'VerifiedBy', type: 'NVARCHAR(255) NULL' },
      { name: 'VerifiedAt', type: 'DATETIME NULL' },
      { name: 'InspectorComment', type: 'NVARCHAR(MAX) NULL' },
      { name: 'ReconciledAmount', type: 'DECIMAL(18,2) NULL' },
      { name: 'POPComment', type: 'NVARCHAR(MAX) NULL' },
      { name: 'ClientPaymentStatus', type: 'NVARCHAR(50) NULL' },
    ]) {
      await pool.request().query(
        `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = '${col.name}')
         BEGIN ALTER TABLE EggProductionVerifications ADD ${col.name} ${col.type} END`
      );
    }

    // Get client EPVs
    const result = await pool.request()
      .input('clientRecordId', sql.Int, parseInt(clientRecordId))
      .query(
        `SELECT Id, ClientRecordId, PeriodMonth, PeriodYear, Status, SentAt, CompletedAt, CompletedBy, Token,
                ReferenceNumber, POPFilePath, POPUploadedAt, POPUploadedBy, IsReconciled, ReconciledBy, ReconciledAt,
                IsVerified, VerifiedBy, VerifiedAt, InspectorComment, ReconciledAmount, POPComment,
                ManualInspection, ManualInspectionBy, ManualInspectionAt,
                EPVType, InspectorId, LinkedEPVId,
                LevyAmount, PulpSoldToTrade, ClientPaymentStatus
         FROM EggProductionVerifications
         WHERE ClientRecordId = @clientRecordId AND (EPVType = 'Client' OR EPVType IS NULL)
         ORDER BY PeriodYear DESC, PeriodMonth DESC`
      );

    // Get inspector EPVs linked to this company's client EPVs
    const inspectorResult = await pool.request()
      .input('clientRecordId', sql.Int, parseInt(clientRecordId))
      .query(
        `SELECT e.Id, e.Status, e.Token, e.ReferenceNumber, e.CompletedAt, e.CompletedBy, e.LinkedEPVId, e.InspectorId,
                e.LevyAmount, e.PulpSoldToTrade,
                u.FirstName AS InspectorFirstName, u.LastName AS InspectorLastName
         FROM EggProductionVerifications e
         LEFT JOIN Users u ON e.InspectorId = u.Id
         WHERE e.ClientRecordId = @clientRecordId AND e.EPVType = 'Inspector'`
      );

    // Build map of inspector EPVs by LinkedEPVId
    const inspectorMap = {};
    inspectorResult.recordset.forEach(ie => {
      inspectorMap[ie.LinkedEPVId] = ie;
    });

    // Attach inspector EPV to each client EPV
    const verifications = result.recordset.map(ce => ({
      ...ce,
      inspectorEPV: inspectorMap[ce.Id] || null,
    }));

    res.json({ verifications });
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
      .query('SELECT Id, ClientRecordId, ReferenceNumber, IsReconciled FROM EggProductionVerifications WHERE Id = @id');

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
         SET POPFilePath = @filePath, POPUploadedAt = GETDATE(), POPUploadedBy = @uploadedBy,
             ClientPaymentStatus = 'Paid'
         WHERE Id = @id`
      );

    await logCompanyAudit(pool, existing.recordset[0].ClientRecordId, 'POP Uploaded', null, `${existing.recordset[0].ReferenceNumber || 'EPV'} - ${req.file.filename}`, uploadedBy, req.body.userRole);
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
      .query('SELECT Id, ClientRecordId, ReferenceNumber, POPFilePath, IsReconciled FROM EggProductionVerifications WHERE Id = @id');

    if (existing.recordset.length === 0) {
      return res.status(404).json({ message: 'Verification not found.' });
    }

    // Admin/Super Admin can reconcile without POP; other roles require it
    const userRole = req.body.userRole || '';
    const isAdminRole = userRole === 'Super Admin' || userRole === 'Admin';
    if (reconciled && !existing.recordset[0].POPFilePath && !isAdminRole) {
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

    await logCompanyAudit(pool, existing.recordset[0].ClientRecordId, 'Reconciled', String(!!existing.recordset[0].IsReconciled), String(reconciled), reconciledBy, req.body.userRole);
    res.json({ message: reconciled ? 'EPV marked as reconciled.' : 'Reconciliation removed.' });
  } catch (err) {
    console.error('Reconcile error:', err);
    res.status(500).json({ message: 'Failed to update reconciliation.' });
  }
});

// PUT /api/epv/:id/verify - Toggle verified status (Inspector/Super Admin only)
router.put('/:id/verify', async (req, res) => {
  const { id } = req.params;
  const { verified, verifiedBy } = req.body;

  try {
    const pool = await getPool();

    // Ensure verification columns exist
    const verifyCols = [
      { name: 'IsVerified', type: 'BIT NOT NULL DEFAULT 0' },
      { name: 'VerifiedBy', type: 'NVARCHAR(255) NULL' },
      { name: 'VerifiedAt', type: 'DATETIME NULL' },
    ];
    for (const col of verifyCols) {
      await pool.request().query(
        `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = '${col.name}')
         BEGIN ALTER TABLE EggProductionVerifications ADD ${col.name} ${col.type} END`
      );
    }

    const existing = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT Id, ClientRecordId, ReferenceNumber, Status, IsVerified FROM EggProductionVerifications WHERE Id = @id');

    if (existing.recordset.length === 0) {
      return res.status(404).json({ message: 'Verification not found.' });
    }

    if (verified && existing.recordset[0].Status !== 'Completed') {
      return res.status(400).json({ message: 'Cannot verify an incomplete EPV.' });
    }

    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('verified', sql.Bit, verified ? 1 : 0)
      .input('verifiedBy', sql.NVarChar, verified ? (verifiedBy || 'Unknown') : null)
      .query(
        `UPDATE EggProductionVerifications
         SET IsVerified = @verified,
             VerifiedBy = ${verified ? '@verifiedBy' : 'NULL'},
             VerifiedAt = ${verified ? 'GETDATE()' : 'NULL'}
         WHERE Id = @id`
      );

    await logCompanyAudit(pool, existing.recordset[0].ClientRecordId, 'Verified', existing.recordset[0].IsVerified ? 'Approved' : 'Not Verified', verified ? 'Inspector Approved' : 'Verification Removed', verifiedBy, req.body.userRole);
    res.json({ message: verified ? 'EPV marked as verified.' : 'Verification removed.' });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ message: 'Failed to update verification.', error: err.message });
  }
});

// PUT /api/epv/:id/manual-inspection - Toggle manual inspection checkbox
router.put('/:id/manual-inspection', async (req, res) => {
  const { id } = req.params;
  const { checked, changedBy, userRole } = req.body;

  try {
    const pool = await getPool();

    // Ensure columns exist
    const cols = [
      { name: 'ManualInspection', type: 'BIT NOT NULL DEFAULT 0' },
      { name: 'ManualInspectionBy', type: 'NVARCHAR(255) NULL' },
      { name: 'ManualInspectionAt', type: 'DATETIME NULL' },
    ];
    for (const col of cols) {
      await pool.request().query(
        `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = '${col.name}')
         BEGIN ALTER TABLE EggProductionVerifications ADD ${col.name} ${col.type} END`
      );
    }

    const existing = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT Id, ClientRecordId, ReferenceNumber, ManualInspection FROM EggProductionVerifications WHERE Id = @id');

    if (existing.recordset.length === 0) {
      return res.status(404).json({ message: 'Verification not found.' });
    }

    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('checked', sql.Bit, checked ? 1 : 0)
      .input('by', sql.NVarChar, checked ? (changedBy || 'Unknown') : null)
      .query(
        `UPDATE EggProductionVerifications
         SET ManualInspection = @checked,
             ManualInspectionBy = ${checked ? '@by' : 'NULL'},
             ManualInspectionAt = ${checked ? 'GETDATE()' : 'NULL'}
         WHERE Id = @id`
      );

    const epv = existing.recordset[0];
    await logCompanyAudit(pool, epv.ClientRecordId, 'Manual Inspection', epv.ManualInspection ? 'Yes' : 'No', checked ? 'Yes' : 'No', changedBy, userRole);
    res.json({ message: checked ? 'Manual inspection marked.' : 'Manual inspection removed.' });
  } catch (err) {
    console.error('Manual inspection error:', err);
    res.status(500).json({ message: 'Failed to update manual inspection.', error: err.message });
  }
});

// PUT /api/epv/:id/reconciled-amount - Save reconciled amount (Admin/Super Admin only)
router.put('/:id/reconciled-amount', async (req, res) => {
  const { id } = req.params;
  const { amount, changedBy, userRole } = req.body;

  try {
    const pool = await getPool();

    // Ensure column exists
    await pool.request().query(
      `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = 'ReconciledAmount')
       BEGIN ALTER TABLE EggProductionVerifications ADD ReconciledAmount DECIMAL(18,2) NULL END`
    );

    // Get old value and ClientRecordId for audit
    const prev = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT ReconciledAmount, ClientRecordId FROM EggProductionVerifications WHERE Id = @id');
    const oldAmount = prev.recordset[0]?.ReconciledAmount;
    const clientRecordId = prev.recordset[0]?.ClientRecordId;

    const newAmount = amount !== null && amount !== '' ? parseFloat(amount) : null;

    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('amount', sql.Decimal(18, 2), newAmount)
      .query('UPDATE EggProductionVerifications SET ReconciledAmount = @amount WHERE Id = @id');

    // Audit log
    if (clientRecordId) {
      await logCompanyAudit(pool, clientRecordId, 'Reconciled Amount', oldAmount != null ? `R ${oldAmount}` : null, newAmount != null ? `R ${newAmount}` : null, changedBy || 'Unknown', userRole);
    }

    res.json({ message: 'Reconciled amount saved.' });
  } catch (err) {
    console.error('Reconciled amount error:', err);
    res.status(500).json({ message: 'Failed to save reconciled amount.' });
  }
});

// PUT /api/epv/:id/comment - Save inspector comment
router.put('/:id/comment', async (req, res) => {
  const { id } = req.params;
  const { comment, commentBy, userRole } = req.body;

  try {
    const pool = await getPool();

    // Ensure column exists
    await pool.request().query(
      `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = 'InspectorComment')
       BEGIN ALTER TABLE EggProductionVerifications ADD InspectorComment NVARCHAR(MAX) NULL END`
    );

    // Get old value and ClientRecordId for audit
    const prev = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT InspectorComment, ClientRecordId FROM EggProductionVerifications WHERE Id = @id');
    const oldComment = prev.recordset[0]?.InspectorComment;
    const clientRecordId = prev.recordset[0]?.ClientRecordId;

    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('comment', sql.NVarChar, comment || null)
      .query('UPDATE EggProductionVerifications SET InspectorComment = @comment WHERE Id = @id');

    // Audit log
    if (clientRecordId) {
      await logCompanyAudit(pool, clientRecordId, 'Inspector Comment', oldComment || null, comment || null, commentBy || 'Unknown', userRole);
    }

    res.json({ message: 'Comment saved.' });
  } catch (err) {
    console.error('Comment error:', err);
    res.status(500).json({ message: 'Failed to save comment.' });
  }
});

// PUT /api/epv/:id/pop-comment - Save POP comment (any user)
router.put('/:id/pop-comment', async (req, res) => {
  const { id } = req.params;
  const { comment, commentBy, userRole } = req.body;

  try {
    const pool = await getPool();

    // Ensure column exists
    await pool.request().query(
      `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = 'POPComment')
       BEGIN ALTER TABLE EggProductionVerifications ADD POPComment NVARCHAR(MAX) NULL END`
    );

    // Get old value and ClientRecordId for audit
    const prev = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT POPComment, ClientRecordId FROM EggProductionVerifications WHERE Id = @id');
    const oldComment = prev.recordset[0]?.POPComment;
    const clientRecordId = prev.recordset[0]?.ClientRecordId;

    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('comment', sql.NVarChar, comment || null)
      .query('UPDATE EggProductionVerifications SET POPComment = @comment WHERE Id = @id');

    // Audit log
    if (clientRecordId) {
      await logCompanyAudit(pool, clientRecordId, 'POP Comment', oldComment || null, comment || null, commentBy || 'Unknown', userRole);
    }

    res.json({ message: 'POP comment saved.' });
  } catch (err) {
    console.error('POP comment error:', err);
    res.status(500).json({ message: 'Failed to save POP comment.' });
  }
});

// PUT /api/epv/:id/payment-status - Update client payment status
router.put('/:id/payment-status', async (req, res) => {
  const { id } = req.params;
  const { status, changedBy, userRole } = req.body;

  try {
    const pool = await getPool();

    // Ensure column exists
    await pool.request().query(
      `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = 'ClientPaymentStatus')
       BEGIN ALTER TABLE EggProductionVerifications ADD ClientPaymentStatus NVARCHAR(50) NULL END`
    );

    // Get old value and ClientRecordId for audit
    const prev = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT ClientPaymentStatus, ClientRecordId FROM EggProductionVerifications WHERE Id = @id');
    const oldStatus = prev.recordset[0]?.ClientPaymentStatus;
    const clientRecordId = prev.recordset[0]?.ClientRecordId;

    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('status', sql.NVarChar, status || null)
      .query('UPDATE EggProductionVerifications SET ClientPaymentStatus = @status WHERE Id = @id');

    // Audit log
    if (clientRecordId) {
      await logCompanyAudit(pool, clientRecordId, 'Client Payment Status', oldStatus || null, status || null, changedBy || 'Unknown', userRole);
    }

    res.json({ message: 'Payment status updated.' });
  } catch (err) {
    console.error('Payment status error:', err);
    res.status(500).json({ message: 'Failed to update payment status.' });
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

    // Get ClientRecordId for audit
    const full = await pool.request()
      .input('id2', sql.Int, parseInt(id))
      .query('SELECT ClientRecordId FROM EggProductionVerifications WHERE Id = @id2');
    const clientRecordId = full.recordset[0]?.ClientRecordId;

    // Clear POP and reconcile fields in DB
    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query(
        `UPDATE EggProductionVerifications
         SET POPFilePath = NULL, POPUploadedAt = NULL, POPUploadedBy = NULL,
             IsReconciled = 0, ReconciledBy = NULL, ReconciledAt = NULL,
             ClientPaymentStatus = 'Not Paid'
         WHERE Id = @id`
      );

    // Audit log
    const { deletedBy, userRole } = req.body || {};
    if (clientRecordId) {
      await logCompanyAudit(pool, clientRecordId, 'POP Deleted', epv.POPFilePath, null, deletedBy || 'Unknown', userRole);
    }

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

// DELETE /api/epv/inspector/:id - Delete an Inspector EPV (Super Admin only)
router.delete('/inspector/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await getPool();

    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query(`SELECT Id, EPVType, ClientRecordId, ReferenceNumber FROM EggProductionVerifications WHERE Id = @id`);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Inspector EPV not found.' });
    }

    if (result.recordset[0].EPVType !== 'Inspector') {
      return res.status(400).json({ message: 'Can only delete Inspector EPVs.' });
    }

    const clientRecordId = result.recordset[0].ClientRecordId;
    const refNumber = result.recordset[0].ReferenceNumber;

    // Delete audit log entries first
    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('DELETE FROM EPVAuditLog WHERE VerificationId = @id');

    // Delete the inspector EPV
    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('DELETE FROM EggProductionVerifications WHERE Id = @id');

    // Audit log
    const { deletedBy, userRole } = req.body || {};
    if (clientRecordId) {
      await logCompanyAudit(pool, clientRecordId, 'Inspector EPV Deleted', refNumber || `EPV #${id}`, null, deletedBy || 'Unknown', userRole);
    }

    res.json({ message: 'Inspector EPV deleted.' });
  } catch (err) {
    console.error('Inspector EPV delete error:', err);
    res.status(500).json({ message: 'Failed to delete Inspector EPV.' });
  }
});

// ===== INSPECTOR EPV ENDPOINTS =====

// POST /api/epv/inspector/create - Create an Inspector EPV linked to a Client EPV
router.post('/inspector/create', async (req, res) => {
  const { clientEpvId, inspectorId, inspectorName, userRole } = req.body;

  if (!clientEpvId || !inspectorId) {
    return res.status(400).json({ message: 'clientEpvId and inspectorId are required.' });
  }

  try {
    const pool = await getPool();

    // Get the client EPV
    const clientEpv = await pool.request()
      .input('id', sql.Int, parseInt(clientEpvId))
      .query('SELECT * FROM EggProductionVerifications WHERE Id = @id');

    if (clientEpv.recordset.length === 0) {
      return res.status(404).json({ message: 'Client EPV not found.' });
    }

    const epv = clientEpv.recordset[0];

    // Check if Inspector EPV already exists for this inspector + client EPV
    const existing = await pool.request()
      .input('linkedId', sql.Int, parseInt(clientEpvId))
      .input('inspectorId', sql.Int, parseInt(inspectorId))
      .query(
        `SELECT Id FROM EggProductionVerifications
         WHERE LinkedEPVId = @linkedId AND InspectorId = @inspectorId AND EPVType = 'Inspector'`
      );

    if (existing.recordset.length > 0) {
      return res.status(409).json({ message: 'An Inspector EPV already exists for this verification.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const refNumber = await generateReferenceNumber(pool, epv.PeriodMonth, epv.PeriodYear);

    // Create the Inspector EPV with same client/period info, pre-filled with facility's figures
    await pool.request()
      .input('clientRecordId', sql.Int, epv.ClientRecordId)
      .input('month', sql.Int, epv.PeriodMonth)
      .input('year', sql.Int, epv.PeriodYear)
      .input('token', sql.NVarChar, token)
      .input('refNumber', sql.NVarChar, refNumber)
      .input('businessName', sql.NVarChar, epv.BusinessName || '')
      .input('facilityType', sql.NVarChar, epv.FacilityType || '')
      .input('facilityProvince', sql.NVarChar, epv.FacilityProvince || '')
      .input('email', sql.NVarChar, epv.EmailAddress || '')
      .input('ownerName', sql.NVarChar, epv.AuthorizedPersonName || '')
      .input('tradingName', sql.NVarChar, epv.TradingName || '')
      .input('positionInCompany', sql.NVarChar, epv.PositionInCompany || '')
      .input('telephoneNumber', sql.NVarChar, epv.TelephoneNumber || '')
      .input('cellPhoneNumber', sql.NVarChar, epv.CellPhoneNumber || '')
      .input('openingStock', sql.Decimal(18, 2), parseFloat(epv.OpeningStock) || 0)
      .input('gradedEggsPurchased', sql.Decimal(18, 2), parseFloat(epv.GradedEggsPurchased) || 0)
      .input('ungradedEggsPurchased', sql.Decimal(18, 2), parseFloat(epv.UngradedEggsPurchased) || 0)
      .input('marketReturns', sql.Decimal(18, 2), parseFloat(epv.MarketReturns) || 0)
      .input('machineLoss', sql.Decimal(18, 2), parseFloat(epv.MachineLoss) || 0)
      .input('sentToPulp', sql.Decimal(18, 2), parseFloat(epv.SentToPulp) || 0)
      .input('destroyed', sql.Decimal(18, 2), parseFloat(epv.Destroyed) || 0)
      .input('soldToTrade', sql.Decimal(18, 2), parseFloat(epv.SoldToTrade) || 0)
      .input('soldToStaff', sql.Decimal(18, 2), parseFloat(epv.SoldToStaff) || 0)
      .input('soldThroughFarmStall', sql.Decimal(18, 2), parseFloat(epv.SoldThroughFarmStall) || 0)
      .input('transferredToOtherProducers', sql.Decimal(18, 2), parseFloat(epv.TransferredToOtherProducers) || 0)
      .input('actualClosingStock', sql.Decimal(18, 2), parseFloat(epv.ActualClosingStock) || 0)
      .input('pulpOpeningStock', sql.Decimal(18, 2), parseFloat(epv.PulpOpeningStock) || 0)
      .input('pulpPurchased', sql.Decimal(18, 2), parseFloat(epv.PulpPurchased) || 0)
      .input('pulpConverted', sql.Decimal(18, 2), parseFloat(epv.PulpConverted) || 0)
      .input('pulpSoldToTrade', sql.Decimal(18, 2), parseFloat(epv.PulpSoldToTrade) || 0)
      .input('pulpSoldToProducers', sql.Decimal(18, 2), parseFloat(epv.PulpSoldToProducers) || 0)
      .input('varianceReason', sql.NVarChar, epv.VarianceReason || '')
      .input('levyAmount', sql.Decimal(18, 2), parseFloat(epv.LevyAmount) || 0)
      .input('inspectorId', sql.Int, parseInt(inspectorId))
      .input('linkedEPVId', sql.Int, parseInt(clientEpvId))
      .input('completedBy', sql.NVarChar, inspectorName || '')
      .query(
        `INSERT INTO EggProductionVerifications
         (ClientRecordId, PeriodMonth, PeriodYear, Token, ReferenceNumber, Status,
          BusinessName, FacilityType, FacilityProvince, EmailAddress, AuthorizedPersonName,
          TradingName, PositionInCompany, TelephoneNumber, CellPhoneNumber,
          OpeningStock, GradedEggsPurchased, UngradedEggsPurchased,
          MarketReturns, MachineLoss, SentToPulp, Destroyed,
          SoldToTrade, SoldToStaff, SoldThroughFarmStall, TransferredToOtherProducers,
          ActualClosingStock,
          PulpOpeningStock, PulpPurchased, PulpConverted, PulpSoldToTrade, PulpSoldToProducers,
          VarianceReason, LevyAmount,
          EPVType, InspectorId, LinkedEPVId)
         VALUES (@clientRecordId, @month, @year, @token, @refNumber, 'Pending',
                 @businessName, @facilityType, @facilityProvince, @email, @ownerName,
                 @tradingName, @positionInCompany, @telephoneNumber, @cellPhoneNumber,
                 @openingStock, @gradedEggsPurchased, @ungradedEggsPurchased,
                 @marketReturns, @machineLoss, @sentToPulp, @destroyed,
                 @soldToTrade, @soldToStaff, @soldThroughFarmStall, @transferredToOtherProducers,
                 @actualClosingStock,
                 @pulpOpeningStock, @pulpPurchased, @pulpConverted, @pulpSoldToTrade, @pulpSoldToProducers,
                 @varianceReason, @levyAmount,
                 'Inspector', @inspectorId, @linkedEPVId)`
      );

    // Audit log
    await logCompanyAudit(pool, epv.ClientRecordId, 'Inspector EPV Created', null, refNumber, inspectorName || 'Unknown', userRole);

    res.json({ message: 'Inspector EPV created.', token });
  } catch (err) {
    console.error('Inspector EPV create error:', err);
    res.status(500).json({ message: 'Failed to create Inspector EPV.' });
  }
});

// GET /api/epv/inspector/company/:clientRecordId - Get both Client and Inspector EPVs for a company
router.get('/inspector/company/:clientRecordId', async (req, res) => {
  const { clientRecordId } = req.params;
  const { inspectorId } = req.query;

  try {
    const pool = await getPool();

    // Get client EPVs
    const clientResult = await pool.request()
      .input('clientRecordId', sql.Int, parseInt(clientRecordId))
      .query(
        `SELECT Id, ClientRecordId, PeriodMonth, PeriodYear, Status, SentAt, CompletedAt, CompletedBy, Token,
                ReferenceNumber, POPFilePath, POPUploadedAt, IsReconciled, IsVerified, VerifiedBy, VerifiedAt, InspectorComment, ReconciledAmount,
                ManualInspection, ManualInspectionBy, ManualInspectionAt,
                EPVType, InspectorId, LinkedEPVId,
                LevyAmount, PulpSoldToTrade
         FROM EggProductionVerifications
         WHERE ClientRecordId = @clientRecordId AND (EPVType = 'Client' OR EPVType IS NULL)
         ORDER BY PeriodYear DESC, PeriodMonth DESC`
      );

    // Get inspector EPVs for this company (optionally filtered by inspectorId)
    let inspectorQuery = `
      SELECT Id, ClientRecordId, PeriodMonth, PeriodYear, Status, CompletedAt, CompletedBy, Token,
             ReferenceNumber, EPVType, InspectorId, LinkedEPVId, LevyAmount, PulpSoldToTrade
      FROM EggProductionVerifications
      WHERE ClientRecordId = @clientRecordId AND EPVType = 'Inspector'
    `;
    const request = pool.request().input('clientRecordId', sql.Int, parseInt(clientRecordId));

    if (inspectorId) {
      inspectorQuery += ' AND InspectorId = @inspectorId';
      request.input('inspectorId', sql.Int, parseInt(inspectorId));
    }

    inspectorQuery += ' ORDER BY PeriodYear DESC, PeriodMonth DESC';
    const inspectorResult = await request.query(inspectorQuery);

    // Build a map of inspector EPVs by LinkedEPVId for quick lookup
    const inspectorMap = {};
    inspectorResult.recordset.forEach(ie => {
      if (!inspectorMap[ie.LinkedEPVId]) inspectorMap[ie.LinkedEPVId] = [];
      inspectorMap[ie.LinkedEPVId].push(ie);
    });

    // Combine: attach inspector EPV info to each client EPV
    const combined = clientResult.recordset.map(ce => ({
      ...ce,
      inspectorEPV: inspectorMap[ce.Id] ? inspectorMap[ce.Id][0] : null,
    }));

    res.json({ epvList: combined, inspectorEPVs: inspectorResult.recordset });
  } catch (err) {
    console.error('Inspector EPV list error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// GET /api/epv/inspector/stats - Dashboard stats for inspector page
// ===== FACILITIES NOT YET COMPLETED EPVs per month for current year =====
router.get('/inspector/not-completed', async (req, res) => {
  const { province } = req.query;

  try {
    const pool = await getPool();
    const curYear = new Date().getFullYear();
    const curMonth = new Date().getMonth() + 1;
    const provFilter = province ? "AND c.FacilityProvince = @province" : "";

    // Date filters
    const filterYear = req.query.year ? parseInt(req.query.year) : null;
    const filterMonth = req.query.month ? parseInt(req.query.month) : null;
    const filterQuarter = req.query.quarter ? parseInt(req.query.quarter) : null;

    // Build list of year+month pairs to check
    // Default: all months from Jan 2025 to current month
    const yearMonths = [];
    if (filterYear && filterMonth) {
      yearMonths.push({ year: filterYear, month: filterMonth });
    } else if (filterYear && filterQuarter) {
      const qsm = (filterQuarter - 1) * 3 + 1;
      for (let m = qsm; m <= qsm + 2; m++) {
        if (filterYear < curYear || m <= curMonth) yearMonths.push({ year: filterYear, month: m });
      }
    } else if (filterYear) {
      const endM = filterYear < curYear ? 12 : curMonth;
      for (let m = 1; m <= endM; m++) yearMonths.push({ year: filterYear, month: m });
    } else if (filterQuarter) {
      // Quarter only — default to current year
      const qsm = (filterQuarter - 1) * 3 + 1;
      for (let m = qsm; m <= qsm + 2; m++) {
        if (m <= curMonth) yearMonths.push({ year: curYear, month: m });
      }
    } else if (filterMonth) {
      // Month only — default to current year
      yearMonths.push({ year: curYear, month: filterMonth });
    } else {
      // No filter — all months from Jan 2025 to current month
      const startYear = 2025;
      for (let y = startYear; y <= curYear; y++) {
        const endM = y < curYear ? 12 : curMonth;
        for (let m = 1; m <= endM; m++) yearMonths.push({ year: y, month: m });
      }
    }

    let results = [];
    if (yearMonths.length > 0) {
      const monthValues = yearMonths.map(ym => `(${ym.year}, ${ym.month})`).join(',');
      const r = pool.request();
      if (province) r.input('province', sql.NVarChar, province);

      const result = await r.query(`
        SELECT c.Id, c.BusinessName, c.FacilityProvince, c.FacilityType, c.Town,
               e.Id AS EPVId, e.Status AS EPVStatus, e.ReferenceNumber, e.Token AS EPVToken,
               m.mo AS PeriodMonth, m.yr AS PeriodYear
        FROM (VALUES ${monthValues}) AS m(yr, mo)
        CROSS JOIN ConsolidatedMasterAbattoirDatabase c
        LEFT JOIN EggProductionVerifications e
          ON e.ClientRecordId = c.Id
          AND (e.EPVType = 'Client' OR e.EPVType IS NULL)
          AND e.PeriodMonth = m.mo
          AND e.PeriodYear = m.yr
        WHERE c.FacilityProvince IS NOT NULL ${provFilter}
          AND (e.Id IS NULL OR e.Status = 'Pending')
        ORDER BY c.FacilityProvince, c.BusinessName
      `);
      results = result.recordset;
    }

    res.json({ notCompleted: results });
  } catch (err) {
    console.error('Not completed error:', err);
    res.status(500).json({ message: 'Failed to load not-completed facilities.' });
  }
});

// ===== PENDING APPROVALS — completed facility EPVs not yet verified =====
router.get('/inspector/pending-approvals', async (req, res) => {
  const { province } = req.query;

  try {
    const pool = await getPool();
    const provFilter = province ? "AND c.FacilityProvince = @province" : "";

    // Date filters
    const curYear = new Date().getFullYear();
    const filterYear = req.query.year ? parseInt(req.query.year) : null;
    const filterMonth = req.query.month ? parseInt(req.query.month) : null;
    const filterQuarter = req.query.quarter ? parseInt(req.query.quarter) : null;
    const effectiveYear = filterYear || ((filterMonth || filterQuarter) ? curYear : null);
    let dateWhere = '';
    if (effectiveYear && filterMonth) {
      dateWhere = ` AND e.PeriodYear = ${effectiveYear} AND e.PeriodMonth = ${filterMonth}`;
    } else if (effectiveYear && filterQuarter) {
      const qsm = (filterQuarter - 1) * 3 + 1;
      dateWhere = ` AND e.PeriodYear = ${effectiveYear} AND e.PeriodMonth BETWEEN ${qsm} AND ${qsm + 2}`;
    } else if (effectiveYear) {
      dateWhere = ` AND e.PeriodYear = ${effectiveYear}`;
    }

    const r = pool.request();
    if (province) r.input('province', sql.NVarChar, province);

    const result = await r.query(`
      SELECT
        e.Id, e.ClientRecordId, e.PeriodMonth, e.PeriodYear, e.Status, e.CompletedAt, e.CompletedBy,
        e.Token, e.ReferenceNumber, e.LevyAmount, e.PulpSoldToTrade, e.SoldToTrade,
        e.IsVerified, e.VerifiedBy, e.VerifiedAt, e.InspectorComment,
        e.ManualInspection, e.ManualInspectionBy, e.ManualInspectionAt,
        e.pop_file_path AS "POPFilePath", e.pop_uploaded_at AS "POPUploadedAt", e.IsReconciled, e.ReconciledAmount,
        c.BusinessName, c.FacilityProvince, c.FacilityType, c.Town,
        ie.Id AS InspEPVId, ie.Token AS InspEPVToken, ie.Status AS InspEPVStatus,
        ie.ReferenceNumber AS InspEPVRef, ie.LevyAmount AS InspLevyAmount,
        ie.PulpSoldToTrade AS InspPulpSoldToTrade
      FROM EggProductionVerifications e
      JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
      LEFT JOIN EggProductionVerifications ie ON ie.LinkedEPVId = e.Id AND ie.EPVType = 'Inspector'
      WHERE e.EPVType = 'Client'
        AND e.Status = 'Completed'
        AND (e.IsVerified = 0 OR e.IsVerified IS NULL)
        AND ie.Id IS NULL
        ${provFilter}${dateWhere}
      ORDER BY e.CompletedAt DESC
    `);

    // Also get EPVs where inspector EPV is pending (rejected, needs inspector to complete)
    const r2 = pool.request();
    if (province) r2.input('province', sql.NVarChar, province);

    const inspPending = await r2.query(`
      SELECT
        e.Id, e.ClientRecordId, e.PeriodMonth, e.PeriodYear, e.Status, e.CompletedAt, e.CompletedBy,
        e.Token, e.ReferenceNumber, e.LevyAmount, e.PulpSoldToTrade, e.SoldToTrade,
        c.BusinessName, c.FacilityProvince, c.FacilityType, c.Town,
        ie.Id AS InspEPVId, ie.Token AS InspEPVToken, ie.Status AS InspEPVStatus,
        ie.ReferenceNumber AS InspEPVRef
      FROM EggProductionVerifications e
      JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
      JOIN EggProductionVerifications ie ON ie.LinkedEPVId = e.Id AND ie.EPVType = 'Inspector' AND ie.Status = 'Pending'
      WHERE e.EPVType = 'Client'
        AND e.Status = 'Completed'
        AND (e.IsVerified = 0 OR e.IsVerified IS NULL)
        ${provFilter}${dateWhere}
      ORDER BY e.CompletedAt DESC
    `);

    res.json({ pendingApprovals: result.recordset, inspectorEPVsToComplete: inspPending.recordset });
  } catch (err) {
    console.error('Pending approvals error:', err);
    res.status(500).json({ message: 'Failed to load pending approvals.' });
  }
});

router.get('/inspector/stats', async (req, res) => {
  const { province } = req.query; // null = all (super admin)

  try {
    const pool = await getPool();
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();
    const curQuarter = Math.ceil(curMonth / 3);
    const qStartMonth = (curQuarter - 1) * 3 + 1;

    // Date filters
    const filterYear = req.query.year ? parseInt(req.query.year) : null;
    const filterMonth = req.query.month ? parseInt(req.query.month) : null;
    const filterQuarter = req.query.quarter ? parseInt(req.query.quarter) : null;

    // Default year to current year if month or quarter specified without year
    const effectiveYear = filterYear || ((filterMonth || filterQuarter) ? curYear : null);
    let dateWhere = '';
    if (effectiveYear && filterMonth) {
      dateWhere = ` AND e.PeriodYear = ${effectiveYear} AND e.PeriodMonth = ${filterMonth}`;
    } else if (effectiveYear && filterQuarter) {
      const qsm = (filterQuarter - 1) * 3 + 1;
      dateWhere = ` AND e.PeriodYear = ${effectiveYear} AND e.PeriodMonth BETWEEN ${qsm} AND ${qsm + 2}`;
    } else if (effectiveYear) {
      dateWhere = ` AND e.PeriodYear = ${effectiveYear}`;
    }

    // Build province filter
    const provFilter = province ? "AND c.FacilityProvince = @province" : "";

    // 1. Facility summary per province
    const facByProv = await (() => {
      const r = pool.request();
      if (province) r.input('province', sql.NVarChar, province);
      return r.query(`
        SELECT c.FacilityProvince, COUNT(DISTINCT c.Id) as FacilityCount
        FROM ConsolidatedMasterAbattoirDatabase c
        WHERE c.FacilityProvince IS NOT NULL ${provFilter}
        GROUP BY c.FacilityProvince
        ORDER BY c.FacilityProvince
      `);
    })();

    // 2. Facilities needing visit this quarter (or filtered period)
    const visitQYear = filterYear || curYear;
    const visitQStart = filterQuarter ? (filterQuarter - 1) * 3 + 1 : (filterMonth ? filterMonth : qStartMonth);
    const visitQEnd = filterQuarter ? (filterQuarter - 1) * 3 + 3 : (filterMonth ? filterMonth : qStartMonth + 2);
    const needVisit = await (() => {
      const r = pool.request();
      r.input('qStart', sql.Int, visitQStart);
      r.input('qEnd', sql.Int, visitQEnd);
      r.input('year', sql.Int, visitQYear);
      if (province) r.input('province', sql.NVarChar, province);
      return r.query(`
        SELECT c.Id, c.BusinessName, c.Town, c.FacilityProvince, c.FacilityType
        FROM ConsolidatedMasterAbattoirDatabase c
        WHERE c.FacilityProvince IS NOT NULL ${provFilter}
          AND NOT EXISTS (
            SELECT 1 FROM EggProductionVerifications e
            WHERE e.ClientRecordId = c.Id
              AND e.EPVType = 'Client'
              AND e.PeriodYear = @year
              AND e.PeriodMonth BETWEEN @qStart AND @qEnd
              AND e.ManualInspection = 1
          )
        ORDER BY c.FacilityProvince, c.BusinessName
      `);
    })();

    // 3. Outstanding amounts (not reconciled)
    const outstanding = await (() => {
      const r = pool.request();
      if (province) r.input('province', sql.NVarChar, province);
      return r.query(`
        SELECT
          c.Id AS ClientRecordId, c.BusinessName, c.Town, c.FacilityProvince,
          SUM(ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * 0.018, 0)) AS TotalBilled,
          SUM(ISNULL(e.ReconciledAmount, 0)) AS TotalPaid,
          SUM(ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * 0.018, 0) - ISNULL(e.ReconciledAmount, 0)) AS TotalOwing
        FROM EggProductionVerifications e
        JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
        WHERE e.EPVType = 'Client' AND e.Status = 'Completed' AND (e.IsReconciled = 0 OR e.IsReconciled IS NULL)
          ${provFilter}${dateWhere}
        GROUP BY c.Id, c.BusinessName, c.Town, c.FacilityProvince
        HAVING SUM(ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * 0.018, 0) - ISNULL(e.ReconciledAmount, 0)) > 0
        ORDER BY TotalOwing DESC
      `);
    })();

    // 4. Aggregate stats
    const stats = await (() => {
      const r = pool.request();
      if (province) r.input('province', sql.NVarChar, province);
      return r.query(`
        SELECT
          COUNT(DISTINCT e.ClientRecordId) AS TotalFacilitiesWithEPV,
          COUNT(e.Id) AS TotalEPVs,
          SUM(CASE WHEN e.IsReconciled = 1 THEN 1 ELSE 0 END) AS ReconciledCount,
          SUM(CASE WHEN e.IsReconciled = 0 OR e.IsReconciled IS NULL THEN 1 ELSE 0 END) AS UnreconciledCount,
          SUM(ISNULL(e.LevyAmount, 0)) AS TotalEggLevy,
          SUM(ISNULL(e.PulpSoldToTrade, 0) * 1.7 * 0.018) AS TotalPulpLevy,
          SUM(ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * 0.018, 0)) AS TotalBilled,
          SUM(ISNULL(e.ReconciledAmount, 0)) AS TotalPaid,
          SUM(ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * 0.018, 0) - ISNULL(e.ReconciledAmount, 0)) AS TotalOutstanding,
          SUM(ISNULL(e.SoldToTrade, 0)) AS TotalEggDozens,
          SUM(ISNULL(e.PulpSoldToTrade, 0)) AS TotalPulpDozens,
          SUM(CASE WHEN ie.Id IS NOT NULL THEN 1 ELSE 0 END) AS TotalRejections,
          SUM(CASE WHEN ie.Id IS NOT NULL AND ie.Status = 'Pending' THEN 1 ELSE 0 END) AS PendingInspectorEPVs,
          SUM(CASE WHEN e.ManualInspection = 1 THEN 1 ELSE 0 END) AS ManualInspections,
          SUM(CASE WHEN e.IsVerified = 1 THEN 1 ELSE 0 END) AS VerifiedCount
        FROM EggProductionVerifications e
        JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
        LEFT JOIN EggProductionVerifications ie ON ie.LinkedEPVId = e.Id AND ie.EPVType = 'Inspector'
        WHERE e.EPVType = 'Client' AND e.Status = 'Completed'
          ${provFilter}${dateWhere}
      `);
    })();

    // 5. Per-month breakdown
    const monthly = await (() => {
      const r = pool.request();
      if (province) r.input('province', sql.NVarChar, province);
      return r.query(`
        SELECT
          e.PeriodMonth, e.PeriodYear,
          COUNT(e.Id) AS EPVCount,
          SUM(ISNULL(e.LevyAmount, 0)) AS EggLevy,
          SUM(ISNULL(e.PulpSoldToTrade, 0) * 1.7 * 0.018) AS PulpLevy,
          SUM(ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * 0.018, 0)) AS TotalBilled,
          SUM(ISNULL(e.ReconciledAmount, 0)) AS TotalPaid,
          SUM(CASE WHEN e.IsReconciled = 1 THEN 1 ELSE 0 END) AS PaidCount,
          SUM(ISNULL(e.SoldToTrade, 0)) AS EggDozens,
          SUM(ISNULL(e.PulpSoldToTrade, 0)) AS PulpDozens,
          SUM(CASE WHEN ie.Id IS NOT NULL THEN 1 ELSE 0 END) AS Rejections
        FROM EggProductionVerifications e
        JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
        LEFT JOIN EggProductionVerifications ie ON ie.LinkedEPVId = e.Id AND ie.EPVType = 'Inspector'
        WHERE e.EPVType = 'Client' AND e.Status = 'Completed'
          ${provFilter}${dateWhere}
        GROUP BY e.PeriodMonth, e.PeriodYear
        ORDER BY e.PeriodYear DESC, e.PeriodMonth DESC
      `);
    })();

    // 6. Rejections per province
    const rejByProv = await (() => {
      const r = pool.request();
      if (province) r.input('province', sql.NVarChar, province);
      return r.query(`
        SELECT c.FacilityProvince, COUNT(ie.Id) AS Rejections
        FROM EggProductionVerifications e
        JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
        JOIN EggProductionVerifications ie ON ie.LinkedEPVId = e.Id AND ie.EPVType = 'Inspector'
        WHERE e.EPVType = 'Client' AND e.Status = 'Completed'
          ${provFilter}${dateWhere}
        GROUP BY c.FacilityProvince
        ORDER BY Rejections DESC
      `);
    })();

    res.json({
      facilitiesByProvince: facByProv.recordset,
      needVisitThisQuarter: needVisit.recordset,
      outstandingByFacility: outstanding.recordset,
      stats: stats.recordset[0],
      monthly: monthly.recordset,
      rejectionsByProvince: rejByProv.recordset,
      quarter: { quarter: curQuarter, year: curYear, startMonth: qStartMonth, endMonth: qStartMonth + 2 },
    });
  } catch (err) {
    console.error('Inspector stats error:', err);
    res.status(500).json({ message: 'Failed to load inspector stats.' });
  }
});

module.exports = router;
module.exports.sendEPVForFacility = sendEPVForFacility;
module.exports.previousMonthPeriod = previousMonthPeriod;
