/**
 * Add Super-collections columns to EggProductionVerifications.
 *
 * Idempotent. Reconciliation stays on the existing IsReconciled /
 * ReconciledAmount / POPFilePath fields; these new fields only track
 * Super-specific state (their invoice, sent flag, comment, and audit
 * of who marked reconciliation).
 */
const sql = require('mssql/msnodesqlv8');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connStr =
  'Driver={ODBC Driver 18 for SQL Server};Server=' + process.env.DB_SERVER +
  ';Database=' + process.env.DB_NAME + ';Trusted_Connection=Yes;TrustServerCertificate=Yes;';

const COLUMNS = [
  { name: 'SuperInvoiceSent',            type: 'BIT NOT NULL DEFAULT 0' },
  { name: 'SuperInvoiceSentAt',          type: 'DATETIME NULL' },
  { name: 'SuperInvoiceSentBy',          type: 'NVARCHAR(255) NULL' },
  { name: 'SuperInvoiceFilePath',        type: 'NVARCHAR(500) NULL' },
  { name: 'SuperInvoiceOriginalName',    type: 'NVARCHAR(500) NULL' },
  { name: 'SuperInvoiceUploadedAt',      type: 'DATETIME NULL' },
  { name: 'SuperInvoiceUploadedBy',      type: 'NVARCHAR(255) NULL' },
  { name: 'SuperComment',                type: 'NVARCHAR(MAX) NULL' },
  { name: 'SuperReconciledBy',           type: 'NVARCHAR(255) NULL' },
  { name: 'SuperReconciledAt',           type: 'DATETIME NULL' },
];

(async () => {
  const pool = await sql.connect({ connectionString: connStr });
  for (const col of COLUMNS) {
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns
                     WHERE object_id = OBJECT_ID('EggProductionVerifications')
                       AND name = '${col.name}')
      BEGIN
        ALTER TABLE EggProductionVerifications ADD ${col.name} ${col.type}
      END
    `);
    console.log('  ' + col.name + ' ensured');
  }
  console.log('Super collections columns done.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
