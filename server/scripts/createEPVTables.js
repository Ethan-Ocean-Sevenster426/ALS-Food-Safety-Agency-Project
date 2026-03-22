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

    // Add ActualClosingStock column if it doesn't exist
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = 'ActualClosingStock')
      BEGIN
        ALTER TABLE EggProductionVerifications ADD ActualClosingStock DECIMAL(18,2) DEFAULT 0
      END
    `);

    // Add LossGain column if it doesn't exist
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = 'LossGain')
      BEGIN
        ALTER TABLE EggProductionVerifications ADD LossGain DECIMAL(18,2) DEFAULT 0
      END
    `);

    // Add TotalE column if it doesn't exist
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = 'TotalE')
      BEGIN
        ALTER TABLE EggProductionVerifications ADD TotalE DECIMAL(18,2) DEFAULT 0
      END
    `);

    console.log('New columns ensured (ActualClosingStock, LossGain, TotalE).');

    // Add Pulp calculation columns
    const pulpColumns = [
      { name: 'PulpOpeningStock', type: 'INT DEFAULT 0' },
      { name: 'PulpPurchased', type: 'INT DEFAULT 0' },
      { name: 'PulpConverted', type: 'INT DEFAULT 0' },
    ];

    for (const col of pulpColumns) {
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = '${col.name}')
        BEGIN
          ALTER TABLE EggProductionVerifications ADD ${col.name} ${col.type}
        END
      `);
    }

    console.log('Pulp columns ensured.');

    // Add Reference Number, POP, and Reconciled columns
    const refColumns = [
      { name: 'ReferenceNumber', type: 'NVARCHAR(50) NULL' },
      { name: 'POPFilePath', type: 'NVARCHAR(500) NULL' },
      { name: 'POPUploadedAt', type: 'DATETIME NULL' },
      { name: 'POPUploadedBy', type: 'NVARCHAR(255) NULL' },
      { name: 'IsReconciled', type: 'BIT NOT NULL DEFAULT 0' },
      { name: 'ReconciledBy', type: 'NVARCHAR(255) NULL' },
      { name: 'ReconciledAt', type: 'DATETIME NULL' },
    ];

    for (const col of refColumns) {
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = '${col.name}')
        BEGIN
          ALTER TABLE EggProductionVerifications ADD ${col.name} ${col.type}
        END
      `);
    }

    console.log('Reference/POP/Reconciled columns ensured.');

    // Add FacilityProvince column to ConsolidatedMasterAbattoirDatabase if it doesn't exist
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ConsolidatedMasterAbattoirDatabase') AND name = 'FacilityProvince')
      BEGIN
        ALTER TABLE ConsolidatedMasterAbattoirDatabase ADD FacilityProvince NVARCHAR(255) NULL
      END
    `);

    console.log('FacilityProvince column ensured on ConsolidatedMasterAbattoirDatabase.');

    // Add FacilityProvince column to EggProductionVerifications if it doesn't exist
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = 'FacilityProvince')
      BEGIN
        ALTER TABLE EggProductionVerifications ADD FacilityProvince NVARCHAR(255) NULL
      END
    `);

    console.log('FacilityProvince column ensured on EggProductionVerifications.');

    // Add Inspector EPV columns
    const inspectorCols = [
      { name: 'EPVType', type: "NVARCHAR(20) NOT NULL DEFAULT 'Client'" },
      { name: 'InspectorId', type: 'INT NULL' },
      { name: 'LinkedEPVId', type: 'INT NULL' },
    ];

    for (const col of inspectorCols) {
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = '${col.name}')
        BEGIN
          ALTER TABLE EggProductionVerifications ADD ${col.name} ${col.type}
        END
      `);
    }

    console.log('Inspector EPV columns ensured (EPVType, InspectorId, LinkedEPVId).');

    // Add VarianceReason column if it doesn't exist
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = 'VarianceReason')
      BEGIN
        ALTER TABLE EggProductionVerifications ADD VarianceReason NVARCHAR(MAX) NULL
      END
    `);

    console.log('VarianceReason column ensured.');

    // Add Pulp Sales columns
    const pulpSalesCols = [
      { name: 'PulpSoldToTrade', type: 'INT DEFAULT 0' },
      { name: 'PulpSoldToProducers', type: 'INT DEFAULT 0' },
    ];

    for (const col of pulpSalesCols) {
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = '${col.name}')
        BEGIN
          ALTER TABLE EggProductionVerifications ADD ${col.name} ${col.type}
        END
      `);
    }

    console.log('Pulp sales columns ensured (PulpSoldToTrade, PulpSoldToProducers).');

    // Add InspectorProvince column to Users table
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'InspectorProvince')
      BEGIN
        ALTER TABLE Users ADD InspectorProvince NVARCHAR(100) NULL
      END
    `);

    console.log('InspectorProvince column ensured on Users table.');

    // Add EPVCycleStatus column to ConsolidatedMasterAbattoirDatabase
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ConsolidatedMasterAbattoirDatabase') AND name = 'EPVCycleStatus')
      BEGIN
        ALTER TABLE ConsolidatedMasterAbattoirDatabase ADD EPVCycleStatus NVARCHAR(50) NULL
      END
    `);

    console.log('EPVCycleStatus column ensured on ConsolidatedMasterAbattoirDatabase.');

    // Add Inspector Verification columns
    const verifyCols = [
      { name: 'IsVerified', type: 'BIT NOT NULL DEFAULT 0' },
      { name: 'VerifiedBy', type: 'NVARCHAR(255) NULL' },
      { name: 'VerifiedAt', type: 'DATETIME NULL' },
    ];

    for (const col of verifyCols) {
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = '${col.name}')
        BEGIN
          ALTER TABLE EggProductionVerifications ADD ${col.name} ${col.type}
        END
      `);
    }

    console.log('Inspector verification columns ensured (IsVerified, VerifiedBy, VerifiedAt).');

    // Add InspectorComment column
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = 'InspectorComment')
      BEGIN
        ALTER TABLE EggProductionVerifications ADD InspectorComment NVARCHAR(MAX) NULL
      END
    `);

    console.log('InspectorComment column ensured.');

    // Add ReconciledAmount column
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('EggProductionVerifications') AND name = 'ReconciledAmount')
      BEGIN
        ALTER TABLE EggProductionVerifications ADD ReconciledAmount DECIMAL(18,2) NULL
      END
    `);

    console.log('ReconciledAmount column ensured.');

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
