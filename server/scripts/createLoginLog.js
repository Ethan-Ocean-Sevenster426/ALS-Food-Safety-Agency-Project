const sql = require('mssql/msnodesqlv8');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connStr =
  'Driver={ODBC Driver 18 for SQL Server};Server=' + process.env.DB_SERVER +
  ';Database=' + process.env.DB_NAME + ';Trusted_Connection=Yes;TrustServerCertificate=Yes;';

(async () => {
  const pool = await sql.connect({ connectionString: connStr });
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='LoginLog' AND xtype='U')
    BEGIN
      CREATE TABLE LoginLog (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        UserId INT NULL,
        Email NVARCHAR(255) NOT NULL,
        Success BIT NOT NULL,
        Reason NVARCHAR(255) NULL,
        IPAddress NVARCHAR(64) NULL,
        UserAgent NVARCHAR(500) NULL,
        LoggedInAt DATETIME DEFAULT GETDATE()
      )
    END
  `);
  console.log('LoginLog table ensured.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
