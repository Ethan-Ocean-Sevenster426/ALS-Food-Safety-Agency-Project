const sql = require('mssql/msnodesqlv8');
require('dotenv').config();

const connStr = `Driver={ODBC Driver 18 for SQL Server};Server=${process.env.DB_SERVER};Database=${process.env.DB_NAME};Trusted_Connection=Yes;TrustServerCertificate=Yes;`;

async function run() {
  const pool = await sql.connect({ connectionString: connStr });

  // 1. Invitations
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Invitations' AND xtype='U')
    CREATE TABLE Invitations (
      Id INT IDENTITY(1,1) PRIMARY KEY,
      ClientRecordId INT NOT NULL,
      Email NVARCHAR(255) NOT NULL,
      Role NVARCHAR(50) NOT NULL,
      Token NVARCHAR(255) NOT NULL,
      InvitedBy NVARCHAR(255) NOT NULL,
      Status NVARCHAR(50) NOT NULL DEFAULT 'Pending',
      AcceptedAt DATETIME NULL,
      CreatedAt DATETIME DEFAULT GETDATE()
    )
  `);
  console.log('Invitations table created.');

  // 2. ConsolidatedMasterAbattoirDatabase (client records)
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ConsolidatedMasterAbattoirDatabase' AND xtype='U')
    CREATE TABLE ConsolidatedMasterAbattoirDatabase (
      Id INT IDENTITY(1,1) PRIMARY KEY,
      BusinessName NVARCHAR(255),
      AccountCode NVARCHAR(100),
      Email NVARCHAR(255),
      Town NVARCHAR(255),
      FacilityType NVARCHAR(100),
      FacilityProvince NVARCHAR(100),
      CompanyRegNumber NVARCHAR(100),
      PhysicalAddress NVARCHAR(500),
      VATNumber NVARCHAR(50),
      AbattoirOwnerName NVARCHAR(255),
      AbattoirOwnerCell NVARCHAR(50),
      AbattoirOwnerEmail NVARCHAR(255),
      AccountsContactName NVARCHAR(255),
      AccountsTelephone NVARCHAR(50),
      AccountsEmail NVARCHAR(255),
      AbattoirManagerName NVARCHAR(255),
      AbattoirManagerCell NVARCHAR(50),
      AbattoirManagerEmail NVARCHAR(255),
      ManualEmail NVARCHAR(255),
      EPVCycleStatus NVARCHAR(50),
      ApprovalStatus NVARCHAR(50),
      VerifiedAt DATETIME NULL,
      VerifiedBy NVARCHAR(255),
      CreatedAt DATETIME DEFAULT GETDATE()
    )
  `);
  console.log('ConsolidatedMasterAbattoirDatabase table created.');

  // 3. LoginLog
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='LoginLog' AND xtype='U')
    CREATE TABLE LoginLog (
      Id INT IDENTITY(1,1) PRIMARY KEY,
      UserId INT NULL,
      Email NVARCHAR(255) NOT NULL,
      Success BIT NOT NULL DEFAULT 0,
      Reason NVARCHAR(255),
      IPAddress NVARCHAR(100),
      UserAgent NVARCHAR(500),
      LoggedInAt DATETIME DEFAULT GETDATE()
    )
  `);
  console.log('LoginLog table created.');

  // 4. EggProductionVerifications
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='EggProductionVerifications' AND xtype='U')
    CREATE TABLE EggProductionVerifications (
      Id INT IDENTITY(1,1) PRIMARY KEY,
      ClientRecordId INT NOT NULL,
      PeriodMonth INT NOT NULL,
      PeriodYear INT NOT NULL,
      Token NVARCHAR(255) NOT NULL,
      ReferenceNumber NVARCHAR(100),
      Status NVARCHAR(50) NOT NULL DEFAULT 'Pending',
      EPVType NVARCHAR(50) DEFAULT 'Client',
      BusinessName NVARCHAR(255),
      FacilityType NVARCHAR(100),
      FacilityProvince NVARCHAR(100),
      EmailAddress NVARCHAR(255),
      AuthorizedPersonName NVARCHAR(255),
      TradingName NVARCHAR(255),
      PositionInCompany NVARCHAR(255),
      TelephoneNumber NVARCHAR(50),
      CellPhoneNumber NVARCHAR(50),
      OpeningStock DECIMAL(18,2) DEFAULT 0,
      EggsProducedDuringMonth INT DEFAULT 0,
      GradedEggsPurchased INT DEFAULT 0,
      UngradedEggsPurchased INT DEFAULT 0,
      TransferredOrPurchasedFromProducers INT DEFAULT 0,
      MarketReturns INT DEFAULT 0,
      MachineLoss INT DEFAULT 0,
      SentToPulp INT DEFAULT 0,
      Destroyed INT DEFAULT 0,
      Exported INT DEFAULT 0,
      SoldToTrade INT DEFAULT 0,
      SoldToStaff INT DEFAULT 0,
      SoldThroughFarmStall INT DEFAULT 0,
      TransferredToOtherProducers INT DEFAULT 0,
      ActualClosingStock DECIMAL(18,2) DEFAULT 0,
      PulpOpeningStock DECIMAL(18,2) DEFAULT 0,
      PulpPurchased DECIMAL(18,2) DEFAULT 0,
      PulpConverted DECIMAL(18,2) DEFAULT 0,
      PulpSoldToTrade DECIMAL(18,2) DEFAULT 0,
      PulpSoldToProducers DECIMAL(18,2) DEFAULT 0,
      PulpConversionLoss DECIMAL(18,2) DEFAULT 0,
      TotalB DECIMAL(18,2) DEFAULT 0,
      TotalC DECIMAL(18,2) DEFAULT 0,
      TotalD DECIMAL(18,2) DEFAULT 0,
      TotalE DECIMAL(18,2) DEFAULT 0,
      ClosingStock DECIMAL(18,2) DEFAULT 0,
      LossGain DECIMAL(18,2) DEFAULT 0,
      LevyAmount DECIMAL(18,4) DEFAULT 0,
      VarianceReason NVARCHAR(MAX),
      EggPurchaseComment NVARCHAR(MAX),
      PulpPurchaseComment NVARCHAR(MAX),
      TransferPurchaseComment NVARCHAR(MAX),
      CompletedBy NVARCHAR(255),
      CompletedAt DATETIME NULL,
      InspectorId INT NULL,
      LinkedEPVId INT NULL,
      InspEPVId INT NULL,
      InspEPVToken NVARCHAR(255),
      InspEPVStatus NVARCHAR(50),
      InspEPVRef NVARCHAR(100),
      IsReconciled BIT DEFAULT 0,
      ReconciledAmount DECIMAL(18,2),
      ReconciledBy NVARCHAR(255),
      ReconciledAt DATETIME NULL,
      IsVerified BIT DEFAULT 0,
      ManualInspection BIT DEFAULT 0,
      POPFilePath NVARCHAR(500),
      POPUploadedAt DATETIME NULL,
      POPUploadedBy NVARCHAR(255),
      POPComment NVARCHAR(MAX),
      IsPaid BIT DEFAULT 0,
      CreatedAt DATETIME DEFAULT GETDATE()
    )
  `);
  console.log('EggProductionVerifications table created.');

  // 5. EPVAuditLog
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='EPVAuditLog' AND xtype='U')
    CREATE TABLE EPVAuditLog (
      Id INT IDENTITY(1,1) PRIMARY KEY,
      VerificationId INT NOT NULL,
      FieldName NVARCHAR(255) NOT NULL,
      OldValue NVARCHAR(MAX),
      NewValue NVARCHAR(MAX),
      ChangedBy NVARCHAR(255) NOT NULL,
      ChangedAt DATETIME DEFAULT GETDATE()
    )
  `);
  console.log('EPVAuditLog table created.');

  // 6. EPVAttachments
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='EPVAttachments' AND xtype='U')
    CREATE TABLE EPVAttachments (
      Id INT IDENTITY(1,1) PRIMARY KEY,
      VerificationId INT NOT NULL,
      Category NVARCHAR(50) NOT NULL,
      FileName NVARCHAR(255) NOT NULL,
      OriginalName NVARCHAR(255) NOT NULL,
      FileSize INT DEFAULT 0,
      MimeType NVARCHAR(100),
      UploadedBy NVARCHAR(255),
      UploadedAt DATETIME DEFAULT GETDATE()
    )
  `);
  console.log('EPVAttachments table created.');

  // 7. EPVInvoices
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='EPVInvoices' AND xtype='U')
    CREATE TABLE EPVInvoices (
      Id INT IDENTITY(1,1) PRIMARY KEY,
      VerificationId INT NOT NULL,
      ClientRecordId INT NOT NULL,
      InvoiceNumber NVARCHAR(100) NOT NULL,
      ReferenceNumber NVARCHAR(100),
      Amount DECIMAL(18,2) NOT NULL,
      FilePath NVARCHAR(500) NOT NULL,
      GeneratedBy NVARCHAR(255),
      CreatedAt DATETIME DEFAULT GETDATE()
    )
  `);
  console.log('EPVInvoices table created.');

  // 8. ClientAuditLog
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ClientAuditLog' AND xtype='U')
    CREATE TABLE ClientAuditLog (
      Id INT IDENTITY(1,1) PRIMARY KEY,
      RecordId INT NOT NULL,
      FieldName NVARCHAR(255) NOT NULL,
      OldValue NVARCHAR(MAX),
      NewValue NVARCHAR(MAX),
      ChangedBy NVARCHAR(255) NOT NULL,
      UserRole NVARCHAR(50),
      ChangedAt DATETIME DEFAULT GETDATE()
    )
  `);
  console.log('ClientAuditLog table created.');

  // 9. EmailSendLog
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='EmailSendLog' AND xtype='U')
    CREATE TABLE EmailSendLog (
      Id INT IDENTITY(1,1) PRIMARY KEY,
      ClientRecordId INT,
      EmailAddress NVARCHAR(255),
      EmailType NVARCHAR(50),
      Subject NVARCHAR(500),
      Status NVARCHAR(50),
      SentBy NVARCHAR(255),
      SentAt DATETIME DEFAULT GETDATE()
    )
  `);
  console.log('EmailSendLog table created.');

  // Ensure InspectorProvince column on Users
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'InspectorProvince')
    ALTER TABLE Users ADD InspectorProvince NVARCHAR(100) NULL
  `);
  console.log('Users.InspectorProvince ensured.');

  console.log('\nAll missing tables created successfully!');
  await pool.close();
  process.exit(0);
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });
