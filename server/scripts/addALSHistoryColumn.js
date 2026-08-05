/**
 * Add ChangedByRole to EPVAuditLog so ALS-side actions can be attributed
 * to the actor's role (ALS vs Super Admin) for the transparency history.
 * Idempotent.
 */
const sql = require('mssql/msnodesqlv8');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connStr =
  'Driver={ODBC Driver 18 for SQL Server};Server=' + process.env.DB_SERVER +
  ';Database=' + process.env.DB_NAME + ';Trusted_Connection=Yes;TrustServerCertificate=Yes;';

(async () => {
  const pool = await sql.connect({ connectionString: connStr });
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns
                   WHERE object_id = OBJECT_ID('EPVAuditLog')
                     AND name = 'ChangedByRole')
    BEGIN
      ALTER TABLE EPVAuditLog ADD ChangedByRole NVARCHAR(50) NULL
    END
  `);
  console.log('EPVAuditLog.ChangedByRole ensured.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
