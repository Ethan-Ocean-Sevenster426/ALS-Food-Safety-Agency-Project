const sql = require('mssql/msnodesqlv8');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connStr =
  'Driver={ODBC Driver 18 for SQL Server};Server=' + process.env.DB_SERVER +
  ';Database=' + process.env.DB_NAME + ';Trusted_Connection=Yes;TrustServerCertificate=Yes;';

(async () => {
  const pool = await sql.connect({ connectionString: connStr });

  for (const col of ['EggPurchaseComment', 'PulpPurchaseComment']) {
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = '${col}')
      BEGIN
        ALTER TABLE EggProductionVerifications ADD ${col} NVARCHAR(MAX) NULL
      END
    `);
    console.log(col + ' column ensured.');
  }

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='EPVAttachments' AND xtype='U')
    BEGIN
      CREATE TABLE EPVAttachments (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        VerificationId INT NOT NULL,
        Category NVARCHAR(20) NOT NULL,
        FileName NVARCHAR(255) NOT NULL,
        OriginalName NVARCHAR(500) NOT NULL,
        FileSize INT NOT NULL,
        MimeType NVARCHAR(100) NOT NULL,
        UploadedAt DATETIME DEFAULT GETDATE(),
        UploadedBy NVARCHAR(255) NULL,
        CONSTRAINT FK_EPVAttach_Verification FOREIGN KEY (VerificationId)
          REFERENCES EggProductionVerifications(Id) ON DELETE CASCADE
      )
    END
  `);
  console.log('EPVAttachments table ensured.');

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
