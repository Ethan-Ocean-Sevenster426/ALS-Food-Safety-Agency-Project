/**
 * Ensure the Powder columns exist on EggProductionVerifications.
 * Idempotent — safe to re-run.
 */
const sql = require('mssql/msnodesqlv8');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connStr =
  'Driver={ODBC Driver 18 for SQL Server};Server=' + process.env.DB_SERVER +
  ';Database=' + process.env.DB_NAME + ';Trusted_Connection=Yes;TrustServerCertificate=Yes;';

const COLUMNS = [
  { name: 'PowderOpeningStock',    type: 'DECIMAL(18,2) DEFAULT 0' },
  { name: 'PowderPurchased',       type: 'DECIMAL(18,2) DEFAULT 0' },
  { name: 'PowderConverted',       type: 'DECIMAL(18,2) DEFAULT 0' },
  { name: 'PowderSoldToTrade',     type: 'DECIMAL(18,2) DEFAULT 0' },
  { name: 'PowderSoldToProducers', type: 'DECIMAL(18,2) DEFAULT 0' },
  { name: 'PowderConversionLoss',  type: 'DECIMAL(18,2) DEFAULT 0' },
  { name: 'PowderPurchaseComment', type: 'NVARCHAR(MAX) NULL' },
  { name: 'TransferPurchaseComment', type: 'NVARCHAR(MAX) NULL' },
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
  console.log('Powder columns ready.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
