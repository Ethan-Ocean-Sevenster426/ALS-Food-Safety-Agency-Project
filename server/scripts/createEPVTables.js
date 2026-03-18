const sql = require('mssql/msnodesqlv8');
require('dotenv').config();

const connStr = `Driver={ODBC Driver 18 for SQL Server};Server=${process.env.DB_SERVER};Database=${process.env.DB_NAME};Trusted_Connection=Yes;TrustServerCertificate=Yes;`;

async function createEPVTables() {
  let pool;
  try {
    pool = await sql.connect({ connectionString: connStr });

    // Create EggProductionVerifications table
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='EggProductionVerifications' AND xtype='U')
      BEGIN
        CREATE TABLE EggProductionVerifications (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          ClientRecordId INT NOT NULL,
          PeriodMonth INT NOT NULL,
          PeriodYear INT NOT NULL,
          Status NVARCHAR(20) NOT NULL DEFAULT 'Pending',
          Token NVARCHAR(255) NOT NULL,
          SentAt DATETIME DEFAULT GETDATE(),
          CompletedAt DATETIME NULL,
          CompletedBy NVARCHAR(255) NULL,

          -- Verification Detail Fields
          BusinessName NVARCHAR(255) NULL,
          FacilityType NVARCHAR(255) NULL,
          TradingName NVARCHAR(255) NULL,
          AuthorizedPersonName NVARCHAR(255) NULL,
          PositionInCompany NVARCHAR(255) NULL,
          TelephoneNumber NVARCHAR(100) NULL,
          CellPhoneNumber NVARCHAR(100) NULL,
          EmailAddress NVARCHAR(255) NULL,

          -- Calculation Fields
          OpeningStock DECIMAL(18,2) DEFAULT 0,
          GradedEggsPurchased DECIMAL(18,2) DEFAULT 0,
          UngradedEggsPurchased DECIMAL(18,2) DEFAULT 0,
          TotalB DECIMAL(18,2) DEFAULT 0,

          MarketReturns DECIMAL(18,2) DEFAULT 0,
          MachineLoss DECIMAL(18,2) DEFAULT 0,
          SentToPulp DECIMAL(18,2) DEFAULT 0,
          Destroyed DECIMAL(18,2) DEFAULT 0,
          TotalC DECIMAL(18,2) DEFAULT 0,

          SoldToTrade DECIMAL(18,2) DEFAULT 0,
          Exported DECIMAL(18,2) DEFAULT 0,
          SoldToStaff DECIMAL(18,2) DEFAULT 0,
          SoldThroughFarmStall DECIMAL(18,2) DEFAULT 0,
          TotalD DECIMAL(18,2) DEFAULT 0,
          LevyAmount DECIMAL(18,4) DEFAULT 0,

          TransferredToOtherProducers DECIMAL(18,2) DEFAULT 0,
          ClosingStock DECIMAL(18,2) DEFAULT 0,

          CreatedAt DATETIME DEFAULT GETDATE(),

          CONSTRAINT FK_EPV_Client FOREIGN KEY (ClientRecordId)
            REFERENCES ConsolidatedMasterAbattoirDatabase(Id)
        )
      END
    `);

    console.log('EggProductionVerifications table ensured.');

    // Create EPVAuditLog table
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='EPVAuditLog' AND xtype='U')
      BEGIN
        CREATE TABLE EPVAuditLog (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          VerificationId INT NOT NULL,
          FieldName NVARCHAR(100) NOT NULL,
          OldValue NVARCHAR(MAX) NULL,
          NewValue NVARCHAR(MAX) NULL,
          ChangedBy NVARCHAR(255) NOT NULL,
          ChangedAt DATETIME DEFAULT GETDATE(),

          CONSTRAINT FK_EPVAudit_Verification FOREIGN KEY (VerificationId)
            REFERENCES EggProductionVerifications(Id)
        )
      END
    `);

    console.log('EPVAuditLog table ensured.');
    console.log('EPV tables created successfully!');
  } catch (err) {
    console.error('Failed to create EPV tables:', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

createEPVTables();
