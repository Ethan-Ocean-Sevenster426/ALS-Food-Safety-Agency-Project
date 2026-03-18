const sql = require('mssql/msnodesqlv8');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connStr = `Driver={ODBC Driver 18 for SQL Server};Server=${process.env.DB_SERVER};Database=${process.env.DB_NAME};Trusted_Connection=Yes;TrustServerCertificate=Yes;`;

async function createAuditLog() {
  let pool;
  try {
    pool = await sql.connect({ connectionString: connStr });

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ClientAuditLog' AND xtype='U')
      BEGIN
        CREATE TABLE ClientAuditLog (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          RecordId INT NOT NULL,
          FieldName NVARCHAR(100) NOT NULL,
          OldValue NVARCHAR(500),
          NewValue NVARCHAR(500),
          ChangedBy NVARCHAR(200) NOT NULL,
          ChangedAt DATETIME DEFAULT GETDATE()
        )
      END
    `);

    console.log('ClientAuditLog table created successfully.');
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

createAuditLog();
