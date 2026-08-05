/**
 * Add AssignedInspectorId and ApprovalStatus columns to
 * ConsolidatedMasterAbattoirDatabase. Introduced upstream by
 *   79a043a feat: inspector-facility allocation, inspector scoping/filtering
 *   c55cbc2 feat: Super Admins selectable as inspectors ...
 * but never migrated on this DB. Idempotent.
 */
const sql = require('mssql/msnodesqlv8');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connStr =
  'Driver={ODBC Driver 18 for SQL Server};Server=' + process.env.DB_SERVER +
  ';Database=' + process.env.DB_NAME + ';Trusted_Connection=Yes;TrustServerCertificate=Yes;';

const COLUMNS = [
  { name: 'AssignedInspectorId', type: 'INT NULL' },
  { name: 'ApprovalStatus',      type: 'NVARCHAR(50) NULL' },
];

(async () => {
  const pool = await sql.connect({ connectionString: connStr });
  for (const col of COLUMNS) {
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns
                     WHERE object_id = OBJECT_ID('ConsolidatedMasterAbattoirDatabase')
                       AND name = '${col.name}')
      BEGIN
        ALTER TABLE ConsolidatedMasterAbattoirDatabase ADD ${col.name} ${col.type}
      END
    `);
    console.log('  ' + col.name + ' ensured');
  }
  console.log('Facility allocation columns ready.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
