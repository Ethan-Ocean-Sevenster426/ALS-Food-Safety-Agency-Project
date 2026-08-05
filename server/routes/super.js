/**
 * Super collections endpoints.
 *
 * The "Super" is the 3rd-party levy collector. This route surfaces
 * EPVs that are ready to invoice (approved by inspector, or rejected
 * with an inspector-revised EPV), and lets them:
 *   - mark their invoice as sent
 *   - upload the invoice PDF (facility can view in Company Overview)
 *   - reconcile payments (updates the same IsReconciled/ReconciledAmount
 *     fields used everywhere else, so existing reports pick it up)
 *   - leave a Super-side comment
 *   - export the table to Excel
 *
 * Access is enforced on the frontend (nav + route guards); the underlying
 * app has no auth middleware today, matching the pattern of every other
 * route file.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const XLSX = require('xlsx');
const { sql, getPool } = require('../config/db');

const router = express.Router();

// Every ALS-side mutation writes one row here so Super Admins and ALS
// users can see a full history of who did what to each EPV.
async function auditAls(pool, epvId, action, oldValue, newValue, actor, role) {
  try {
    await pool.request()
      .input('vid', sql.Int, epvId)
      .input('field', sql.NVarChar, action)
      .input('oldV', sql.NVarChar, oldValue != null ? String(oldValue) : null)
      .input('newV', sql.NVarChar, newValue != null ? String(newValue) : null)
      .input('by', sql.NVarChar, actor || 'ALS')
      .input('role', sql.NVarChar, role || 'ALS')
      .query(`INSERT INTO EPVAuditLog (VerificationId, FieldName, OldValue, NewValue, ChangedBy, ChangedByRole)
              VALUES (@vid, @field, @oldV, @newV, @by, @role)`);
  } catch (e) {
    console.error('auditAls insert failed:', e.message);
  }
}

// Multer for Super's invoice uploads: 15 MB, PDF/PNG/JPG
const invoiceDir = path.join(__dirname, '..', 'uploads', 'super-invoices');
fs.mkdirSync(invoiceDir, { recursive: true });
const invoiceUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, invoiceDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const safe = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
      cb(null, `super-inv-${req.params.id}-${Date.now()}-${safe}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.pdf', '.png', '.jpg', '.jpeg'].includes(path.extname(file.originalname).toLowerCase());
    if (ok) cb(null, true); else cb(new Error('Only PDF, PNG, and JPG files are allowed.'));
  },
});

// Shared SELECT: base row + resolved invoice amount.
// Amount is inspector's revised figures when the client EPV is not verified
// AND there's a completed linked inspector EPV; otherwise the facility's.
const BASE_SELECT = `
  SELECT
    e.Id, e.ClientRecordId, e.PeriodMonth, e.PeriodYear, e.ReferenceNumber,
    e.CompletedAt, e.CompletedBy,
    e.IsVerified, e.VerifiedAt, e.VerifiedBy,
    e.IsReconciled, e.ReconciledAmount, e.ReconciledBy, e.ReconciledAt,
    e.SuperInvoiceSent, e.SuperInvoiceSentAt, e.SuperInvoiceSentBy,
    e.SuperInvoiceFilePath, e.SuperInvoiceOriginalName, e.SuperInvoiceUploadedAt, e.SuperInvoiceUploadedBy,
    e.SuperComment, e.SuperReconciledBy, e.SuperReconciledAt,
    e.POPFilePath, e.POPUploadedAt, e.POPUploadedBy, e.POPComment,
    c.BusinessName, c.AccountCode, c.FacilityProvince, c.FacilityType, c.Email AS FacilityEmail,
    -- Facility figures: sales quantities that drive the levy + resulting Rand amounts
    ISNULL(e.SoldToTrade, 0)        AS FacilityEggsSoldToTrade,
    ISNULL(e.PulpSoldToTrade, 0)    AS FacilityPulpSoldToTrade,
    ISNULL(e.PowderSoldToTrade, 0)  AS FacilityPowderSoldToTrade,
    e.LevyAmount            AS FacilityEggLevy,
    ISNULL(e.PulpSoldToTrade, 0) * 1.7 * 0.02   AS FacilityPulpLevy,
    ISNULL(e.PowderSoldToTrade, 0) * 0.02       AS FacilityPowderLevy,
    ISNULL(e.LevyAmount, 0)
      + ISNULL(e.PulpSoldToTrade, 0) * 1.7 * 0.02
      + ISNULL(e.PowderSoldToTrade, 0) * 0.02   AS FacilityTotal,
    -- Inspector figures (may be null if inspector never captured)
    ie.Id                   AS InspectorEpvId,
    ie.Status               AS InspectorEpvStatus,
    ISNULL(ie.SoldToTrade, 0)        AS InspectorEggsSoldToTrade,
    ISNULL(ie.PulpSoldToTrade, 0)    AS InspectorPulpSoldToTrade,
    ISNULL(ie.PowderSoldToTrade, 0)  AS InspectorPowderSoldToTrade,
    ie.LevyAmount           AS InspectorEggLevy,
    ISNULL(ie.PulpSoldToTrade, 0) * 1.7 * 0.02   AS InspectorPulpLevy,
    ISNULL(ie.PowderSoldToTrade, 0) * 0.02       AS InspectorPowderLevy,
    ISNULL(ie.LevyAmount, 0)
      + ISNULL(ie.PulpSoldToTrade, 0) * 1.7 * 0.02
      + ISNULL(ie.PowderSoldToTrade, 0) * 0.02   AS InspectorTotal,
    -- Resolved sales quantities used for the invoice (approved = facility, rejected = inspector)
    CASE WHEN e.IsVerified = 1 THEN ISNULL(e.SoldToTrade, 0)
         WHEN ie.Id IS NOT NULL AND ie.Status = 'Completed' THEN ISNULL(ie.SoldToTrade, 0)
         ELSE 0 END AS InvoiceEggsSoldToTrade,
    CASE WHEN e.IsVerified = 1 THEN ISNULL(e.PulpSoldToTrade, 0)
         WHEN ie.Id IS NOT NULL AND ie.Status = 'Completed' THEN ISNULL(ie.PulpSoldToTrade, 0)
         ELSE 0 END AS InvoicePulpSoldToTrade,
    CASE WHEN e.IsVerified = 1 THEN ISNULL(e.PowderSoldToTrade, 0)
         WHEN ie.Id IS NOT NULL AND ie.Status = 'Completed' THEN ISNULL(ie.PowderSoldToTrade, 0)
         ELSE 0 END AS InvoicePowderSoldToTrade,
    -- The amount the ALS collector should actually invoice on
    CASE
      WHEN e.IsVerified = 1 THEN
        ISNULL(e.LevyAmount, 0)
        + ISNULL(e.PulpSoldToTrade, 0) * 1.7 * 0.02
        + ISNULL(e.PowderSoldToTrade, 0) * 0.02
      WHEN ie.Id IS NOT NULL AND ie.Status = 'Completed' THEN
        ISNULL(ie.LevyAmount, 0)
        + ISNULL(ie.PulpSoldToTrade, 0) * 1.7 * 0.02
        + ISNULL(ie.PowderSoldToTrade, 0) * 0.02
      ELSE 0
    END AS InvoiceAmount,
    CASE
      WHEN e.IsVerified = 1 THEN 'Approved'
      WHEN ie.Id IS NOT NULL AND ie.Status = 'Completed' THEN 'Rejected'
      ELSE 'Pending'
    END AS ApprovalStatus,
    -- The EPV Id whose figures are being invoiced on (facility or inspector)
    CASE WHEN e.IsVerified = 1 THEN e.Id
         WHEN ie.Id IS NOT NULL AND ie.Status = 'Completed' THEN ie.Id
         ELSE NULL END AS InvoiceSourceEpvId
  FROM EggProductionVerifications e
  JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
  LEFT JOIN EggProductionVerifications ie
    ON ie.LinkedEPVId = e.Id AND ie.EPVType = 'Inspector'
  WHERE e.EPVType = 'Client'
    AND e.Status = 'Completed'
    AND (
      e.IsVerified = 1
      OR (ie.Id IS NOT NULL AND ie.Status = 'Completed')
    )
`;

// GET /api/super/invoiceable — list EPVs eligible for Super to invoice.
router.get('/invoiceable', async (req, res) => {
  try {
    const pool = await getPool();
    const { year, month, search, invoiceSent, reconciled, approvalStatus } = req.query;

    const filters = [];
    const request = pool.request();

    if (year)  { filters.push('e.PeriodYear = @year');  request.input('year',  sql.Int, parseInt(year)); }
    if (month) { filters.push('e.PeriodMonth = @month'); request.input('month', sql.Int, parseInt(month)); }
    if (search) {
      filters.push('(c.BusinessName LIKE @search OR c.AccountCode LIKE @search OR e.ReferenceNumber LIKE @search)');
      request.input('search', sql.NVarChar, `%${search}%`);
    }
    if (invoiceSent === 'true')  filters.push('e.SuperInvoiceSent = 1');
    if (invoiceSent === 'false') filters.push('(e.SuperInvoiceSent = 0 OR e.SuperInvoiceSent IS NULL)');
    if (reconciled === 'true')   filters.push('e.IsReconciled = 1');
    if (reconciled === 'false')  filters.push('(e.IsReconciled = 0 OR e.IsReconciled IS NULL)');

    const extra = filters.length ? ' AND ' + filters.join(' AND ') : '';
    let approvalHaving = '';
    if (approvalStatus === 'approved') approvalHaving = " AND e.IsVerified = 1";
    if (approvalStatus === 'rejected') approvalHaving = " AND (e.IsVerified = 0 OR e.IsVerified IS NULL) AND ie.Id IS NOT NULL AND ie.Status = 'Completed'";

    const result = await request.query(
      BASE_SELECT + extra + approvalHaving +
      ' ORDER BY e.PeriodYear DESC, e.PeriodMonth DESC, c.BusinessName'
    );

    res.json({ data: result.recordset });
  } catch (err) {
    console.error('super invoiceable error:', err);
    res.status(500).json({ message: 'Failed to load invoiceable EPVs.' });
  }
});

// GET /api/super/kpis — headline KPIs across all invoiceable EPVs.
router.get('/kpis', async (req, res) => {
  try {
    const pool = await getPool();
    const { year, month } = req.query;
    const request = pool.request();
    const filters = [];
    if (year)  { filters.push('e.PeriodYear = @year');  request.input('year',  sql.Int, parseInt(year)); }
    if (month) { filters.push('e.PeriodMonth = @month'); request.input('month', sql.Int, parseInt(month)); }
    const extra = filters.length ? ' AND ' + filters.join(' AND ') : '';

    const result = await request.query(`
      SELECT
        COUNT(*)                                                          AS TotalInvoiceable,
        SUM(CASE WHEN e.SuperInvoiceSent = 1 THEN 1 ELSE 0 END)           AS InvoicesSent,
        SUM(CASE WHEN e.IsReconciled = 1 THEN 1 ELSE 0 END)               AS Reconciled,
        SUM(CASE WHEN e.SuperInvoiceFilePath IS NOT NULL THEN 1 ELSE 0 END) AS InvoiceFilesUploaded,
        SUM(
          CASE
            WHEN e.IsVerified = 1 THEN
              ISNULL(e.LevyAmount, 0)
              + ISNULL(e.PulpSoldToTrade, 0) * 1.7 * 0.02
              + ISNULL(e.PowderSoldToTrade, 0) * 0.02
            WHEN ie.Id IS NOT NULL AND ie.Status = 'Completed' THEN
              ISNULL(ie.LevyAmount, 0)
              + ISNULL(ie.PulpSoldToTrade, 0) * 1.7 * 0.02
              + ISNULL(ie.PowderSoldToTrade, 0) * 0.02
            ELSE 0
          END
        ) AS TotalBillable,
        SUM(ISNULL(e.ReconciledAmount, 0)) AS TotalCollected
      FROM EggProductionVerifications e
      JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
      LEFT JOIN EggProductionVerifications ie
        ON ie.LinkedEPVId = e.Id AND ie.EPVType = 'Inspector'
      WHERE e.EPVType = 'Client'
        AND e.Status = 'Completed'
        AND (e.IsVerified = 1 OR (ie.Id IS NOT NULL AND ie.Status = 'Completed'))
        ${extra}
    `);

    const r = result.recordset[0] || {};
    const billable   = Number(r.TotalBillable) || 0;
    const collected  = Number(r.TotalCollected) || 0;
    const outstanding = billable - collected;
    const collectionRate = billable > 0 ? Math.round((collected / billable) * 100) : 0;

    res.json({
      totalInvoiceable: r.TotalInvoiceable || 0,
      invoicesSent: r.InvoicesSent || 0,
      reconciled: r.Reconciled || 0,
      invoiceFilesUploaded: r.InvoiceFilesUploaded || 0,
      totalBillable: billable,
      totalCollected: collected,
      totalOutstanding: outstanding,
      collectionRate,
    });
  } catch (err) {
    console.error('super kpis error:', err);
    res.status(500).json({ message: 'Failed to load KPIs.' });
  }
});

// PUT /api/super/:id/invoice-sent — toggle 'ALS invoice has been sent'
router.put('/:id/invoice-sent', async (req, res) => {
  const { id } = req.params;
  const { sent, by, byRole } = req.body || {};
  try {
    const pool = await getPool();
    if (sent) {
      await pool.request()
        .input('id', sql.Int, parseInt(id))
        .input('by', sql.NVarChar, by || 'ALS')
        .query(`UPDATE EggProductionVerifications
                SET SuperInvoiceSent = 1, SuperInvoiceSentAt = GETDATE(), SuperInvoiceSentBy = @by
                WHERE Id = @id`);
      await auditAls(pool, parseInt(id), 'ALS Invoice Sent', 'No', 'Yes', by, byRole);
    } else {
      await pool.request()
        .input('id', sql.Int, parseInt(id))
        .query(`UPDATE EggProductionVerifications
                SET SuperInvoiceSent = 0, SuperInvoiceSentAt = NULL, SuperInvoiceSentBy = NULL
                WHERE Id = @id`);
      await auditAls(pool, parseInt(id), 'ALS Invoice Sent', 'Yes', 'No', by, byRole);
    }
    res.json({ message: sent ? 'Marked invoice as sent.' : 'Cleared invoice-sent flag.' });
  } catch (err) {
    console.error('als invoice-sent error:', err);
    res.status(500).json({ message: 'Failed to update invoice-sent flag.' });
  }
});

// PUT /api/super/:id/reconcile — record payment on the shared IsReconciled fields
router.put('/:id/reconcile', async (req, res) => {
  const { id } = req.params;
  const { reconciled, amount, by, byRole } = req.body || {};
  try {
    const pool = await getPool();
    const prev = await pool.request().input('id', sql.Int, parseInt(id))
      .query('SELECT IsReconciled, ReconciledAmount FROM EggProductionVerifications WHERE Id = @id');
    const prevAmt = prev.recordset[0]?.ReconciledAmount;
    if (reconciled) {
      const newAmt = amount != null ? parseFloat(amount) : null;
      await pool.request()
        .input('id', sql.Int, parseInt(id))
        .input('amt', sql.Decimal(18, 2), newAmt)
        .input('by', sql.NVarChar, by || 'ALS')
        .query(`UPDATE EggProductionVerifications
                SET IsReconciled = 1,
                    ReconciledAmount = @amt,
                    ReconciledBy = @by, ReconciledAt = GETDATE(),
                    SuperReconciledBy = @by, SuperReconciledAt = GETDATE()
                WHERE Id = @id`);
      await auditAls(pool, parseInt(id), 'Reconciled Payment',
        prevAmt != null ? `R ${prevAmt}` : 'Not reconciled',
        newAmt != null ? `R ${newAmt.toFixed(2)}` : 'Reconciled',
        by, byRole);
    } else {
      await pool.request()
        .input('id', sql.Int, parseInt(id))
        .query(`UPDATE EggProductionVerifications
                SET IsReconciled = 0,
                    ReconciledAmount = NULL,
                    ReconciledBy = NULL, ReconciledAt = NULL,
                    SuperReconciledBy = NULL, SuperReconciledAt = NULL
                WHERE Id = @id`);
      await auditAls(pool, parseInt(id), 'Reconciled Payment',
        prevAmt != null ? `R ${prevAmt}` : 'Reconciled',
        'Cleared', by, byRole);
    }
    res.json({ message: reconciled ? 'Reconciled.' : 'Reconciliation cleared.' });
  } catch (err) {
    console.error('als reconcile error:', err);
    res.status(500).json({ message: 'Failed to update reconciliation.' });
  }
});

// PUT /api/super/:id/comment — set ALS's comment
router.put('/:id/comment', async (req, res) => {
  const { id } = req.params;
  const { comment, by, byRole } = req.body || {};
  try {
    const pool = await getPool();
    const prev = await pool.request().input('id', sql.Int, parseInt(id))
      .query('SELECT SuperComment FROM EggProductionVerifications WHERE Id = @id');
    const oldC = prev.recordset[0]?.SuperComment || '';
    const newC = (comment || '').slice(0, 4000);
    if (oldC === newC) return res.json({ message: 'No change.' });
    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('comment', sql.NVarChar, newC)
      .query(`UPDATE EggProductionVerifications SET SuperComment = @comment WHERE Id = @id`);
    await auditAls(pool, parseInt(id), 'ALS Comment',
      oldC || '(empty)', newC || '(cleared)', by, byRole);
    res.json({ message: 'Comment saved.' });
  } catch (err) {
    console.error('als comment error:', err);
    res.status(500).json({ message: 'Failed to save comment.' });
  }
});

// POST /api/super/:id/invoice-file — upload Super's invoice
router.post('/:id/invoice-file', invoiceUpload.single('file'), async (req, res) => {
  const { id } = req.params;
  const { uploadedBy } = req.body || {};
  if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
  try {
    const pool = await getPool();
    // If a previous file exists, remove it from disk so we don't orphan it
    const prev = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT SuperInvoiceFilePath FROM EggProductionVerifications WHERE Id = @id');
    const prevPath = prev.recordset[0]?.SuperInvoiceFilePath;
    if (prevPath) {
      try { fs.unlinkSync(path.join(invoiceDir, prevPath)); } catch (_) {}
    }

    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('fname', sql.NVarChar, req.file.filename)
      .input('orig', sql.NVarChar, req.file.originalname)
      .input('by', sql.NVarChar, uploadedBy || 'ALS')
      .query(`UPDATE EggProductionVerifications
              SET SuperInvoiceFilePath = @fname,
                  SuperInvoiceOriginalName = @orig,
                  SuperInvoiceUploadedAt = GETDATE(),
                  SuperInvoiceUploadedBy = @by
              WHERE Id = @id`);
    await auditAls(pool, parseInt(id), 'ALS Invoice Uploaded',
      prevPath ? 'Replaced' : null, req.file.originalname,
      uploadedBy, req.body?.uploadedByRole);

    res.status(201).json({ message: 'Invoice uploaded.', file: req.file.filename, original: req.file.originalname });
  } catch (err) {
    console.error('super invoice upload error:', err);
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    res.status(500).json({ message: 'Failed to upload invoice.' });
  }
});

// GET /api/super/:id/invoice-file — download Super's invoice
router.get('/:id/invoice-file', async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT SuperInvoiceFilePath, SuperInvoiceOriginalName FROM EggProductionVerifications WHERE Id = @id');
    const row = r.recordset[0];
    if (!row?.SuperInvoiceFilePath) return res.status(404).json({ message: 'No invoice on file.' });
    const filePath = path.join(invoiceDir, row.SuperInvoiceFilePath);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File missing on disk.' });
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${row.SuperInvoiceOriginalName || row.SuperInvoiceFilePath}"`);
    res.sendFile(filePath);
  } catch (err) {
    console.error('super invoice fetch error:', err);
    res.status(500).json({ message: 'Failed to fetch invoice.' });
  }
});

// DELETE /api/super/:id/invoice-file — remove ALS's invoice
router.delete('/:id/invoice-file', async (req, res) => {
  const { id } = req.params;
  const { by, byRole } = req.body || {};
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT SuperInvoiceFilePath, SuperInvoiceOriginalName FROM EggProductionVerifications WHERE Id = @id');
    const p = r.recordset[0]?.SuperInvoiceFilePath;
    const origName = r.recordset[0]?.SuperInvoiceOriginalName;
    if (p) { try { fs.unlinkSync(path.join(invoiceDir, p)); } catch (_) {} }
    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query(`UPDATE EggProductionVerifications
              SET SuperInvoiceFilePath = NULL, SuperInvoiceOriginalName = NULL,
                  SuperInvoiceUploadedAt = NULL, SuperInvoiceUploadedBy = NULL
              WHERE Id = @id`);
    await auditAls(pool, parseInt(id), 'ALS Invoice Removed',
      origName || 'file', null, by, byRole);
    res.json({ message: 'Invoice removed.' });
  } catch (err) {
    console.error('als invoice delete error:', err);
    res.status(500).json({ message: 'Failed to remove invoice.' });
  }
});

// GET /api/super/:id/history — audit trail for one EPV (both ALS and Super Admin actions)
router.get('/:id/history', async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query(`SELECT Id, FieldName, OldValue, NewValue, ChangedBy, ChangedByRole, ChangedAt
              FROM EPVAuditLog
              WHERE VerificationId = @id
              ORDER BY ChangedAt DESC, Id DESC`);
    res.json({ data: r.recordset });
  } catch (err) {
    console.error('als history error:', err);
    res.status(500).json({ message: 'Failed to load history.' });
  }
});

// GET /api/super/pop/:id — proxy the facility POP through ALS's endpoint
router.get('/pop/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT POPFilePath FROM EggProductionVerifications WHERE Id = @id');
    const p = r.recordset[0]?.POPFilePath;
    if (!p) return res.status(404).json({ message: 'No POP uploaded.' });
    const filePath = path.join(__dirname, '..', 'uploads', 'pop', p);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File missing on disk.' });
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${p}"`);
    res.sendFile(filePath);
  } catch (err) {
    console.error('super pop fetch error:', err);
    res.status(500).json({ message: 'Failed to fetch POP.' });
  }
});

// GET /api/super/export.xlsx — export the current view to Excel
router.get('/export.xlsx', async (req, res) => {
  try {
    const pool = await getPool();
    const { year, month, search, invoiceSent, reconciled, approvalStatus } = req.query;

    const filters = [];
    const request = pool.request();
    if (year)  { filters.push('e.PeriodYear = @year');  request.input('year',  sql.Int, parseInt(year)); }
    if (month) { filters.push('e.PeriodMonth = @month'); request.input('month', sql.Int, parseInt(month)); }
    if (search) {
      filters.push('(c.BusinessName LIKE @search OR c.AccountCode LIKE @search OR e.ReferenceNumber LIKE @search)');
      request.input('search', sql.NVarChar, `%${search}%`);
    }
    if (invoiceSent === 'true')  filters.push('e.SuperInvoiceSent = 1');
    if (invoiceSent === 'false') filters.push('(e.SuperInvoiceSent = 0 OR e.SuperInvoiceSent IS NULL)');
    if (reconciled === 'true')   filters.push('e.IsReconciled = 1');
    if (reconciled === 'false')  filters.push('(e.IsReconciled = 0 OR e.IsReconciled IS NULL)');
    let approvalHaving = '';
    if (approvalStatus === 'approved') approvalHaving = " AND e.IsVerified = 1";
    if (approvalStatus === 'rejected') approvalHaving = " AND (e.IsVerified = 0 OR e.IsVerified IS NULL) AND ie.Id IS NOT NULL AND ie.Status = 'Completed'";
    const extra = filters.length ? ' AND ' + filters.join(' AND ') : '';

    const rows = (await request.query(
      BASE_SELECT + extra + approvalHaving + ' ORDER BY e.PeriodYear DESC, e.PeriodMonth DESC, c.BusinessName'
    )).recordset;

    // All Rand amounts below EXCLUDE VAT — the levy is calculated pre-VAT.
    const shaped = rows.map(r => ({
      Reference: r.ReferenceNumber,
      Facility: r.BusinessName,
      AccountCode: r.AccountCode,
      Province: r.FacilityProvince,
      Period: `${String(r.PeriodMonth).padStart(2, '0')}/${r.PeriodYear}`,
      ApprovalStatus: r.ApprovalStatus,
      // Sales quantities used to calculate the invoice (source of the levy)
      InvoiceEggsSoldToTrade_dozens: +(r.InvoiceEggsSoldToTrade || 0).toFixed(2),
      InvoicePulpSoldToTrade_kg: +(r.InvoicePulpSoldToTrade || 0).toFixed(2),
      InvoicePowderSoldToTrade_kg: +(r.InvoicePowderSoldToTrade || 0).toFixed(2),
      // Facility figures — sales quantities + resulting Rand
      FacilityEggsSoldToTrade_dozens: +(r.FacilityEggsSoldToTrade || 0).toFixed(2),
      FacilityPulpSoldToTrade_kg: +(r.FacilityPulpSoldToTrade || 0).toFixed(2),
      FacilityPowderSoldToTrade_kg: +(r.FacilityPowderSoldToTrade || 0).toFixed(2),
      'FacilityEggLevy_excl_VAT': +(r.FacilityEggLevy || 0).toFixed(2),
      'FacilityPulpLevy_excl_VAT': +(r.FacilityPulpLevy || 0).toFixed(2),
      'FacilityPowderLevy_excl_VAT': +(r.FacilityPowderLevy || 0).toFixed(2),
      'FacilityTotal_excl_VAT': +(r.FacilityTotal || 0).toFixed(2),
      // Inspector figures — sales quantities + resulting Rand
      InspectorEggsSoldToTrade_dozens: +(r.InspectorEggsSoldToTrade || 0).toFixed(2),
      InspectorPulpSoldToTrade_kg: +(r.InspectorPulpSoldToTrade || 0).toFixed(2),
      InspectorPowderSoldToTrade_kg: +(r.InspectorPowderSoldToTrade || 0).toFixed(2),
      'InspectorEggLevy_excl_VAT': +(r.InspectorEggLevy || 0).toFixed(2),
      'InspectorPulpLevy_excl_VAT': +(r.InspectorPulpLevy || 0).toFixed(2),
      'InspectorPowderLevy_excl_VAT': +(r.InspectorPowderLevy || 0).toFixed(2),
      'InspectorTotal_excl_VAT': +(r.InspectorTotal || 0).toFixed(2),
      // Invoice totals + payment state
      'InvoiceAmount_excl_VAT': +(r.InvoiceAmount || 0).toFixed(2),
      InvoiceSent: r.SuperInvoiceSent ? 'Yes' : 'No',
      InvoiceSentAt: r.SuperInvoiceSentAt || '',
      InvoiceFile: r.SuperInvoiceOriginalName || '',
      POPUploaded: r.POPFilePath ? 'Yes' : 'No',
      Reconciled: r.IsReconciled ? 'Yes' : 'No',
      'AmountPaid_excl_VAT': +(r.ReconciledAmount || 0).toFixed(2),
      'Outstanding_excl_VAT': +((r.InvoiceAmount || 0) - (r.ReconciledAmount || 0)).toFixed(2),
      ALSComment: r.SuperComment || '',
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
    XLSX.utils.book_append_sheet(wb, ws, 'Super Collections');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    // Nicely readable filename: "ALS Collections Report - <Month YYYY> - <YYYY-MM-DD>.xlsx"
    // The month suffix only appears when the user filtered to a specific period.
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const stamp = new Date().toISOString().slice(0, 10);
    const parts = ['ALS Collections Report'];
    if (year && month) parts.push(`${MONTHS[parseInt(month) - 1]} ${year}`);
    else if (year)     parts.push(String(year));
    parts.push(stamp);
    const fileName = parts.join(' - ') + '.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buf);
  } catch (err) {
    console.error('super export error:', err);
    res.status(500).json({ message: 'Failed to export.' });
  }
});

module.exports = router;
