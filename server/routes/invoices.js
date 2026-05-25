const express = require('express');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { sql, getPool } = require('../config/db');
const { sendEmail, sendEmailToEach } = require('../services/emailService');

const router = express.Router();

const LEVY_RATE = 0.020;
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Tables already exist in PostgreSQL — no-op
async function ensureInvoicesTable(pool) {}
async function ensureEmailSendLog(pool) {}

async function logCompanyAudit(pool, recordId, fieldName, oldValue, newValue, changedBy, userRole) {
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

// Generate unique invoice number: INV-YYYY-MM-XXXX
async function generateInvoiceNumber(pool, month, year) {
  const prefix = `INV-${year}-${String(month).padStart(2, '0')}`;
  const result = await pool.request()
    .input('prefix', sql.NVarChar, `${prefix}%`)
    .query(`SELECT COUNT(*) AS cnt FROM EPVInvoices WHERE InvoiceNumber LIKE @prefix`);
  const seq = (result.recordset[0].cnt || 0) + 1;
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

// Calculate totals from EPV data
function calcTotals(epv) {
  const eggLevy = parseFloat(epv.LevyAmount) || 0;
  const pulpSoldToTrade = parseInt(epv.PulpSoldToTrade) || 0;
  const pulpLevyDozens = Math.round(pulpSoldToTrade * 1.7);
  const pulpLevy = pulpLevyDozens * LEVY_RATE;
  return { eggLevy, pulpLevy, total: eggLevy + pulpLevy };
}

// Build PDF Pro Forma Invoice
function buildInvoicePDF(invoiceData) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(__dirname, '..', 'uploads', 'invoices', `${invoiceData.invoiceNumber}.pdf`);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    // Header bar
    doc.rect(0, 0, 595, 100).fill('#4f46e5');
    doc.fontSize(28).fillColor('#fff').text('EPVS', 50, 25, { align: 'left' });
    doc.fontSize(10).fillColor('rgba(255,255,255,0.85)').text('Egg Production Verification System', 50, 58);
    doc.fontSize(22).fillColor('#fff').text('PRO FORMA INVOICE', 300, 35, { align: 'right' });

    // Reset text color
    doc.fillColor('#333');

    // Invoice details box
    const y1 = 120;
    doc.fontSize(10).fillColor('#666');
    doc.text('Invoice Number:', 50, y1);
    doc.fontSize(10).fillColor('#333').font('Helvetica-Bold').text(invoiceData.invoiceNumber, 160, y1);
    doc.font('Helvetica');

    doc.fillColor('#666').text('Reference:', 50, y1 + 18);
    doc.fillColor('#0E7C7B').font('Helvetica-Bold').text(invoiceData.referenceNumber, 160, y1 + 18);
    doc.font('Helvetica').fillColor('#333');

    doc.fillColor('#666').text('Date:', 50, y1 + 36);
    doc.fillColor('#333').text(new Date().toLocaleDateString('en-ZA'), 160, y1 + 36);

    doc.fillColor('#666').text('Period:', 50, y1 + 54);
    doc.fillColor('#333').text(invoiceData.period, 160, y1 + 54);

    // Right side - Bill To
    doc.fillColor('#666').text('Bill To:', 350, y1);
    doc.fillColor('#333').font('Helvetica-Bold').text(invoiceData.businessName, 350, y1 + 18);
    doc.font('Helvetica');
    if (invoiceData.tradingName) doc.text(`t/a ${invoiceData.tradingName}`, 350, y1 + 33);
    if (invoiceData.province) doc.text(invoiceData.province, 350, y1 + 48);
    if (invoiceData.email) doc.fillColor('#4f46e5').text(invoiceData.email, 350, y1 + 63);

    doc.fillColor('#333');

    // Divider
    const tableTop = y1 + 100;
    doc.moveTo(50, tableTop).lineTo(545, tableTop).stroke('#ddd');

    // Table header
    doc.rect(50, tableTop + 5, 495, 25).fill('#f3f4f6');
    doc.fillColor('#333').font('Helvetica-Bold').fontSize(10);
    doc.text('Description', 60, tableTop + 12);
    doc.text('Qty/Details', 300, tableTop + 12);
    doc.text('Amount', 460, tableTop + 12, { align: 'right', width: 75 });
    doc.font('Helvetica').fillColor('#333');

    // Table rows
    let rowY = tableTop + 38;
    const rows = [];

    // Egg levy
    if (invoiceData.eggLevy > 0) {
      rows.push({
        desc: 'Egg Levy',
        detail: `Levy on ${invoiceData.totalD || 0} dozen eggs @ R${LEVY_RATE}/dozen`,
        amount: invoiceData.eggLevy,
      });
    }

    // Pulp levy
    if (invoiceData.pulpLevy > 0) {
      rows.push({
        desc: 'Pulp Levy',
        detail: `${invoiceData.pulpSoldToTrade || 0} containers x 1.7 = ${Math.round((invoiceData.pulpSoldToTrade || 0) * 1.7)} dozen @ R${LEVY_RATE}/dozen`,
        amount: invoiceData.pulpLevy,
      });
    }

    if (rows.length === 0) {
      rows.push({ desc: 'Egg Production Levy', detail: 'No levy amounts calculated', amount: 0 });
    }

    rows.forEach((row, i) => {
      if (i % 2 === 1) doc.rect(50, rowY - 5, 495, 22).fill('#fafafa');
      doc.fillColor('#333');
      doc.fontSize(10).text(row.desc, 60, rowY);
      doc.fontSize(8).fillColor('#666').text(row.detail, 60, rowY + 13);
      doc.fillColor('#333').fontSize(10).text(`R ${row.amount.toFixed(2)}`, 460, rowY, { align: 'right', width: 75 });
      rowY += 32;
    });

    // Total line
    doc.moveTo(350, rowY + 5).lineTo(545, rowY + 5).stroke('#ddd');
    doc.rect(350, rowY + 10, 195, 30).fill('#4f46e5');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(12);
    doc.text('TOTAL DUE:', 360, rowY + 18);
    doc.text(`R ${invoiceData.total.toFixed(2)}`, 460, rowY + 18, { align: 'right', width: 75 });

    doc.fillColor('#333').font('Helvetica');

    // Payment instructions
    const payY = rowY + 65;
    doc.rect(50, payY, 495, 80).fill('#f0fdf4').stroke('#bbf7d0');
    doc.fillColor('#15803d').font('Helvetica-Bold').fontSize(11).text('Payment Instructions', 65, payY + 10);
    doc.font('Helvetica').fontSize(9).fillColor('#166534');
    doc.text('Please use the Reference Number above as your payment reference.', 65, payY + 28);
    doc.text('Upload your Proof of Payment (POP) to the EPVS system after making payment.', 65, payY + 42);
    doc.text('Payment is due within 30 days of the invoice date.', 65, payY + 56);

    // Footer
    doc.fillColor('#aaa').fontSize(8);
    doc.text('This is a system-generated Pro Forma Invoice from the Egg Production Verification System (EPVS).', 50, 750, { align: 'center' });
    doc.text(`Generated on ${new Date().toLocaleString('en-ZA')}`, 50, 762, { align: 'center' });

    doc.end();

    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

// POST /api/invoices/generate - Generate a Pro Forma Invoice for an EPV
router.post('/generate', async (req, res) => {
  const { verificationId, generatedBy, userRole } = req.body;

  if (!verificationId) {
    return res.status(400).json({ message: 'verificationId is required.' });
  }

  try {
    const pool = await getPool();
    await ensureInvoicesTable(pool);

    // Check if invoice already exists for this EPV
    const existing = await pool.request()
      .input('vId', sql.Int, parseInt(verificationId))
      .query('SELECT Id, InvoiceNumber FROM EPVInvoices WHERE VerificationId = @vId');

    if (existing.recordset.length > 0) {
      return res.status(409).json({
        message: 'Invoice already exists for this verification.',
        invoice: existing.recordset[0],
      });
    }

    // Get full EPV data
    const epvResult = await pool.request()
      .input('id', sql.Int, parseInt(verificationId))
      .query(`SELECT e.*, c.Email, c.AbattoirOwnerEmail, c.AccountsEmail, c.AbattoirManagerEmail,
                     c.BusinessName AS CompanyName
              FROM EggProductionVerifications e
              LEFT JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
              WHERE e.Id = @id`);

    if (epvResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Verification not found.' });
    }

    const epv = epvResult.recordset[0];

    // Check if there's an inspector EPV (rejected case) — use inspector amounts
    let sourceEpv = epv;
    if (!epv.IsVerified) {
      const inspResult = await pool.request()
        .input('linkedId', sql.Int, parseInt(verificationId))
        .query(`SELECT * FROM EggProductionVerifications WHERE LinkedEPVId = @linkedId AND EPVType = 'Inspector' AND Status = 'Completed'`);
      if (inspResult.recordset.length > 0) {
        sourceEpv = inspResult.recordset[0];
      }
    }

    const totals = calcTotals(sourceEpv);
    const invoiceNumber = await generateInvoiceNumber(pool, epv.PeriodMonth, epv.PeriodYear);
    const period = `${MONTH_NAMES[(epv.PeriodMonth || 1) - 1]} ${epv.PeriodYear}`;

    const invoiceData = {
      invoiceNumber,
      referenceNumber: epv.ReferenceNumber || `EPV-${epv.Id}`,
      period,
      businessName: epv.CompanyName || epv.BusinessName || 'Unknown',
      tradingName: epv.TradingName || '',
      province: epv.FacilityProvince || '',
      email: epv.Email || epv.EmailAddress || '',
      eggLevy: totals.eggLevy,
      pulpLevy: totals.pulpLevy,
      total: totals.total,
      totalD: parseFloat(sourceEpv.TotalD) || 0,
      pulpSoldToTrade: parseInt(sourceEpv.PulpSoldToTrade) || 0,
    };

    const filePath = await buildInvoicePDF(invoiceData);
    const fileName = path.basename(filePath);

    // Save to DB
    await pool.request()
      .input('vId', sql.Int, parseInt(verificationId))
      .input('clientRecordId', sql.Int, epv.ClientRecordId)
      .input('invoiceNumber', sql.NVarChar, invoiceNumber)
      .input('refNumber', sql.NVarChar, epv.ReferenceNumber || null)
      .input('amount', sql.Decimal(18, 2), totals.total)
      .input('filePath', sql.NVarChar, fileName)
      .input('generatedBy', sql.NVarChar, generatedBy || 'Unknown')
      .query(
        `INSERT INTO EPVInvoices (VerificationId, ClientRecordId, InvoiceNumber, ReferenceNumber, Amount, FilePath, GeneratedBy)
         VALUES (@vId, @clientRecordId, @invoiceNumber, @refNumber, @amount, @filePath, @generatedBy)`
      );

    // Audit log
    await logCompanyAudit(pool, epv.ClientRecordId, 'Invoice Generated', null, `${invoiceNumber} — R ${totals.total.toFixed(2)}`, generatedBy || 'Unknown', userRole);

    res.json({ message: 'Invoice generated.', invoiceNumber, fileName });
  } catch (err) {
    console.error('Invoice generate error:', err);
    res.status(500).json({ message: 'Failed to generate invoice.' });
  }
});

// DELETE /api/invoices/:id - Delete an invoice (Admin/Super Admin only)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { deletedBy, userRole } = req.body || {};

  try {
    const pool = await getPool();
    await ensureInvoicesTable(pool);

    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('SELECT Id, InvoiceNumber, FilePath, ClientRecordId, Amount FROM EPVInvoices WHERE Id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Invoice not found.' });
    }

    const inv = result.recordset[0];

    // Delete the PDF file
    const filePath = path.join(__dirname, '..', 'uploads', 'invoices', inv.FilePath);
    try { fs.unlinkSync(filePath); } catch (e) { /* file may already be gone */ }

    // Delete from DB
    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('DELETE FROM EPVInvoices WHERE Id = @id');

    // Audit log
    await logCompanyAudit(pool, inv.ClientRecordId, 'Invoice Deleted', `${inv.InvoiceNumber} — R ${parseFloat(inv.Amount).toFixed(2)}`, null, deletedBy || 'Unknown', userRole);

    res.json({ message: 'Invoice deleted.' });
  } catch (err) {
    console.error('Invoice delete error:', err);
    res.status(500).json({ message: 'Failed to delete invoice.' });
  }
});

// POST /api/invoices/send/:id - Send invoice to facility emails
router.post('/send/:id', async (req, res) => {
  const { id } = req.params;
  const { sentBy, userRole } = req.body;

  try {
    const pool = await getPool();
    await ensureInvoicesTable(pool);

    const invResult = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query(`SELECT i.*, e.PeriodMonth, e.PeriodYear, e.ReferenceNumber,
                     c.BusinessName, c.Email, c.AbattoirOwnerEmail, c.AccountsEmail, c.AbattoirManagerEmail, c.ManualEmail
              FROM EPVInvoices i
              JOIN EggProductionVerifications e ON i.VerificationId = e.Id
              JOIN ConsolidatedMasterAbattoirDatabase c ON i.ClientRecordId = c.Id
              WHERE i.Id = @id`);

    if (invResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Invoice not found.' });
    }

    const inv = invResult.recordset[0];

    // Collect all facility emails (validate format to avoid API errors)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const emails = [inv.Email, inv.AbattoirOwnerEmail, inv.AccountsEmail, inv.AbattoirManagerEmail, inv.ManualEmail]
      .filter(e => e && e.trim() && emailRegex.test(e.trim()));
    const uniqueEmails = [...new Set(emails.map(e => e.trim().toLowerCase()))];

    if (uniqueEmails.length === 0) {
      return res.status(400).json({ message: 'No email addresses found for this facility.' });
    }

    const period = `${MONTH_NAMES[(inv.PeriodMonth || 1) - 1]} ${inv.PeriodYear}`;
    const toEmail = uniqueEmails[0];
    const ccEmails = uniqueEmails.slice(1).join(', ');

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #0E7C7B 0%, #065f5e 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: #fff; margin: 0; font-size: 28px;">EPVS</h1>
          <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Egg Production Verification System</p>
        </div>
        <div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <h2 style="color: #333; margin-top: 0;">Pro Forma Invoice</h2>
          <p style="color: #555; font-size: 15px; line-height: 1.6;">
            Dear <strong>${inv.BusinessName}</strong>,
          </p>
          <p style="color: #555; font-size: 15px; line-height: 1.6;">
            Please find attached the Pro Forma Invoice for the Egg Production Levy for
            <strong style="color: #0E7C7B;">${period}</strong>.
          </p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 20px 0;">
            <table style="width: 100%; font-size: 14px; color: #555;">
              <tr><td style="padding: 4px 0;"><strong>Invoice Number:</strong></td><td>${inv.InvoiceNumber}</td></tr>
              <tr><td style="padding: 4px 0;"><strong>Reference:</strong></td><td style="color: #0E7C7B; font-weight: 600;">${inv.ReferenceNumber || '—'}</td></tr>
              <tr><td style="padding: 4px 0;"><strong>Amount Due:</strong></td><td style="color: #dc2626; font-weight: 700; font-size: 16px;">R ${parseFloat(inv.Amount).toFixed(2)}</td></tr>
            </table>
          </div>
          <p style="color: #555; font-size: 15px; line-height: 1.6;">
            Please use the reference number <strong style="color: #0E7C7B;">${inv.ReferenceNumber || inv.InvoiceNumber}</strong> when making payment,
            and upload your Proof of Payment (POP) to the EPVS system.
          </p>
          <div style="text-align: center; margin: 25px 0;">
            <a href="https://egg-production-verification.fsa-pty.co.za/company" style="display: inline-block; background-color: #0E7C7B; color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
              Go to EPVS Portal
            </a>
          </div>
        </div>
        <p style="color: #aaa; font-size: 11px; text-align: center; margin-top: 20px;">
          This email was sent by the EPVS system. If you did not expect this email, please contact your administrator.
        </p>
      </div>
    `;

    const emailSubject = `Pro Forma Invoice ${inv.InvoiceNumber} — ${period} — R ${parseFloat(inv.Amount).toFixed(2)}`;

    // Send to each recipient individually to track failures
    await ensureEmailSendLog(pool);
    const { succeeded, failed } = await sendEmailToEach({
      recipients: uniqueEmails,
      subject: emailSubject,
      html: emailHtml,
    });

    // Log each result to EmailSendLog
    for (const email of succeeded) {
      await pool.request()
        .input('crid', sql.Int, inv.ClientRecordId)
        .input('addr', sql.NVarChar, email)
        .input('type', sql.NVarChar, 'Invoice')
        .input('subj', sql.NVarChar, emailSubject)
        .input('status', sql.NVarChar, 'Sent')
        .input('by', sql.NVarChar, sentBy || 'Unknown')
        .query(`INSERT INTO EmailSendLog (ClientRecordId, EmailAddress, EmailType, Subject, Status, SentBy)
                VALUES (@crid, @addr, @type, @subj, @status, @by)`);
    }
    for (const email of failed) {
      await pool.request()
        .input('crid', sql.Int, inv.ClientRecordId)
        .input('addr', sql.NVarChar, email)
        .input('type', sql.NVarChar, 'Invoice')
        .input('subj', sql.NVarChar, emailSubject)
        .input('status', sql.NVarChar, 'Failed')
        .input('by', sql.NVarChar, sentBy || 'Unknown')
        .query(`INSERT INTO EmailSendLog (ClientRecordId, EmailAddress, EmailType, Subject, Status, SentBy)
                VALUES (@crid, @addr, @type, @subj, @status, @by)`);
    }

    if (succeeded.length === 0) {
      return res.status(500).json({ message: 'All emails failed to send.', failed });
    }

    // Update DB
    const sentToList = succeeded.join(', ');
    const failedList = failed.length > 0 ? failed.join(', ') : null;
    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('sentBy', sql.NVarChar, sentBy || 'Unknown')
      .input('sentTo', sql.NVarChar, sentToList + (failedList ? ` | FAILED: ${failedList}` : ''))
      .query(`UPDATE EPVInvoices SET SentAt = GETDATE(), SentBy = @sentBy, SentTo = @sentTo WHERE Id = @id`);

    // Audit log
    await logCompanyAudit(pool, inv.ClientRecordId, 'Invoice Sent', null, `${inv.InvoiceNumber} sent to ${sentToList}${failedList ? ' | Failed: ' + failedList : ''}`, sentBy || 'Unknown', userRole);

    res.json({ message: `Invoice sent to ${succeeded.length} recipient(s).${failed.length > 0 ? ` Failed: ${failed.join(', ')}` : ''}`, sentTo: sentToList, failed });
  } catch (err) {
    console.error('Invoice send error:', err);
    res.status(500).json({ message: 'Failed to send invoice.' });
  }
});

// GET /api/invoices/company/:clientRecordId - List invoices for a company
router.get('/company/:clientRecordId', async (req, res) => {
  const { clientRecordId } = req.params;

  try {
    const pool = await getPool();
    await ensureInvoicesTable(pool);

    const result = await pool.request()
      .input('clientRecordId', sql.Int, parseInt(clientRecordId))
      .query(
        `SELECT i.Id, i.VerificationId, i.InvoiceNumber, i.ReferenceNumber, i.Amount,
                i.FilePath, i.GeneratedBy, i.GeneratedAt, i.SentAt, i.SentTo, i.SentBy
         FROM EPVInvoices i
         WHERE i.ClientRecordId = @clientRecordId
         ORDER BY i.GeneratedAt DESC`
      );

    res.json(result.recordset);
  } catch (err) {
    console.error('Invoice list error:', err);
    res.status(500).json({ message: 'Failed to load invoices.' });
  }
});

// GET /api/invoices/epv/:verificationId - Get invoice for a specific EPV
router.get('/epv/:verificationId', async (req, res) => {
  const { verificationId } = req.params;

  try {
    const pool = await getPool();
    await ensureInvoicesTable(pool);

    const result = await pool.request()
      .input('vId', sql.Int, parseInt(verificationId))
      .query(
        `SELECT Id, VerificationId, InvoiceNumber, ReferenceNumber, Amount,
                FilePath, GeneratedBy, GeneratedAt, SentAt, SentTo, SentBy
         FROM EPVInvoices WHERE VerificationId = @vId`
      );

    res.json(result.recordset.length > 0 ? result.recordset[0] : null);
  } catch (err) {
    console.error('Invoice by EPV error:', err);
    res.status(500).json({ message: 'Failed to load invoice.' });
  }
});

// GET /api/invoices/download/:fileName - Download/view invoice PDF
router.get('/download/:fileName', (req, res) => {
  const filePath = path.join(__dirname, '..', 'uploads', 'invoices', req.params.fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'Invoice file not found.' });
  }
  res.sendFile(filePath);
});

// GET /api/invoices/email-log/:clientRecordId - Get email send log for a company
router.get('/email-log/:clientRecordId', async (req, res) => {
  const { clientRecordId } = req.params;
  try {
    const pool = await getPool();
    await ensureEmailSendLog(pool);

    const result = await pool.request()
      .input('crid', sql.Int, parseInt(clientRecordId))
      .query(
        `SELECT EmailAddress, EmailType, Status, SentAt, Subject
         FROM EmailSendLog
         WHERE ClientRecordId = @crid
         ORDER BY SentAt DESC`
      );

    // Build a map of latest status per email address
    const emailStatus = {};
    for (const row of result.recordset) {
      if (!emailStatus[row.EmailAddress]) {
        emailStatus[row.EmailAddress] = row.Status;
      }
    }

    res.json({ log: result.recordset, emailStatus });
  } catch (err) {
    console.error('Email log error:', err);
    res.status(500).json({ message: 'Failed to load email log.' });
  }
});

module.exports = router;
