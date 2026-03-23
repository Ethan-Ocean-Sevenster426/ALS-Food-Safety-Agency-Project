const sql = require('mssql/msnodesqlv8');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const masterConnStr = `Driver={ODBC Driver 18 for SQL Server};Server=${process.env.DB_SERVER};Trusted_Connection=Yes;TrustServerCertificate=Yes;`;

async function initializeDatabase() {
  let pool;
  try {
    // Connect to master to create the database
    pool = await sql.connect({ connectionString: masterConnStr });

    await pool.request().query(`
      IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = '${process.env.DB_NAME}')
      BEGIN
        CREATE DATABASE [${process.env.DB_NAME}]
      END
    `);

    console.log(`Database "${process.env.DB_NAME}" ensured.`);
    await pool.close();

    // Connect to the app database
    const appConnStr = `Driver={ODBC Driver 18 for SQL Server};Server=${process.env.DB_SERVER};Database=${process.env.DB_NAME};Trusted_Connection=Yes;TrustServerCertificate=Yes;`;
    pool = await sql.connect({ connectionString: appConnStr });

    // Create Users table
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Users' AND xtype='U')
      BEGIN
        CREATE TABLE Users (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          FirstName NVARCHAR(100) NOT NULL,
          LastName NVARCHAR(100) NOT NULL,
          Email NVARCHAR(255) NOT NULL UNIQUE,
          PasswordHash NVARCHAR(255) NOT NULL,
          Role NVARCHAR(50) NOT NULL DEFAULT 'User',
          CreatedAt DATETIME DEFAULT GETDATE()
        )
      END
    `);

    // Add IsActive column if it doesn't exist
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'IsActive')
      BEGIN
        ALTER TABLE Users ADD IsActive BIT NOT NULL DEFAULT 1
      END
    `);

    console.log('Users table ensured.');

    // Seed default user: Anthony
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('StrongPassword123!', salt);

    await pool.request()
      .input('firstName', sql.NVarChar, 'Anthony')
      .input('lastName', sql.NVarChar, 'Penzes')
      .input('email', sql.NVarChar, 'anthony@epvs.com')
      .input('passwordHash', sql.NVarChar, passwordHash)
      .query(`
        IF NOT EXISTS (SELECT Id FROM Users WHERE Email = @email)
        BEGIN
          INSERT INTO Users (FirstName, LastName, Email, PasswordHash, Role)
          VALUES (@firstName, @lastName, @email, @passwordHash, 'Super Admin')
        END
      `);

    console.log('Default user "Anthony" created (anthony@epvs.com).');

    // Create SupportTicketCategories table
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='SupportTicketCategories' AND xtype='U')
      BEGIN
        CREATE TABLE SupportTicketCategories (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          Name NVARCHAR(100) NOT NULL,
          CategoryType NVARCHAR(20) NOT NULL,
          IsActive BIT NOT NULL DEFAULT 1
        )
      END
    `);

    // Add SortOrder column if it doesn't exist
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('SupportTicketCategories') AND name = 'SortOrder')
      BEGIN
        ALTER TABLE SupportTicketCategories ADD SortOrder INT NOT NULL DEFAULT 0
      END
    `);

    // Seed categories
    const categories = [
      // Account & Access
      { name: 'Access/Permission Issue', type: 'Administration', sortOrder: 1 },
      { name: 'User Registration/Invitation Issue', type: 'Administration', sortOrder: 2 },
      { name: 'Role or Permission Change Request', type: 'Administration', sortOrder: 3 },
      // EPV & Verification
      { name: 'EPV Submission Issue', type: 'Administration', sortOrder: 4 },
      { name: 'EPV Data Incorrect/Amendment', type: 'Administration', sortOrder: 5 },
      { name: 'EPV Status Not Updating', type: 'IT', sortOrder: 6 },
      { name: 'Inspector Verification Issue', type: 'Administration', sortOrder: 7 },
      // Payment & Reconciliation
      { name: 'Payment Status Issue', type: 'Administration', sortOrder: 8 },
      { name: 'Proof of Payment Upload Issue', type: 'IT', sortOrder: 9 },
      { name: 'Reconciliation Issue', type: 'Administration', sortOrder: 10 },
      { name: 'Levy Calculation Query', type: 'Administration', sortOrder: 11 },
      // Dashboard & Reports
      { name: 'Dashboard Data Incorrect', type: 'IT', sortOrder: 12 },
      { name: 'Report Generation/Export Issue', type: 'IT', sortOrder: 13 },
      // Company & Facility
      { name: 'Company Overview Issue', type: 'Administration', sortOrder: 14 },
      { name: 'Facility Information Update', type: 'Administration', sortOrder: 15 },
      { name: 'Province Assignment Issue', type: 'Administration', sortOrder: 16 },
      // General
      { name: 'Question/Help', type: 'Administration', sortOrder: 17 },
      { name: 'Feature Request', type: 'IT', sortOrder: 18 },
      { name: 'Performance/Speed Issue', type: 'IT', sortOrder: 19 },
      { name: 'System Error/Bug', type: 'IT', sortOrder: 20 },
      { name: 'Other', type: 'Administration', sortOrder: 21 },
    ];

    for (const cat of categories) {
      await pool.request()
        .input('name', sql.NVarChar, cat.name)
        .input('type', sql.NVarChar, cat.type)
        .input('sortOrder', sql.Int, cat.sortOrder)
        .query(`
          IF NOT EXISTS (SELECT Id FROM SupportTicketCategories WHERE Name = @name)
            INSERT INTO SupportTicketCategories (Name, CategoryType, SortOrder) VALUES (@name, @type, @sortOrder)
          ELSE
            UPDATE SupportTicketCategories SET CategoryType = @type, SortOrder = @sortOrder WHERE Name = @name
        `);
    }

    // Deactivate old categories no longer in the list
    const categoryNames = categories.map(c => `'${c.name.replace(/'/g, "''")}'`).join(',');
    await pool.request().query(`
      UPDATE SupportTicketCategories SET IsActive = 0
      WHERE Name NOT IN (${categoryNames}) AND IsActive = 1
    `);

    console.log('SupportTicketCategories table ensured and seeded.');

    // Create SupportTickets table
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='SupportTickets' AND xtype='U')
      BEGIN
        CREATE TABLE SupportTickets (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          CategoryId INT NOT NULL,
          CategoryType NVARCHAR(20) NOT NULL,
          Subject NVARCHAR(255) NOT NULL,
          Description NVARCHAR(MAX),
          Priority NVARCHAR(20) NOT NULL DEFAULT 'Medium',
          Status NVARCHAR(20) NOT NULL DEFAULT 'Open',
          CreatedByUserId INT NOT NULL,
          ClientRecordId INT NULL,
          AssignedToUserId INT NULL,
          CreatedAt DATETIME DEFAULT GETDATE(),
          UpdatedAt DATETIME DEFAULT GETDATE()
        )
      END
    `);

    console.log('SupportTickets table ensured.');

    // Create SupportTicketComments table
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='SupportTicketComments' AND xtype='U')
      BEGIN
        CREATE TABLE SupportTicketComments (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          TicketId INT NOT NULL,
          UserId INT NOT NULL,
          Comment NVARCHAR(MAX) NOT NULL,
          CreatedAt DATETIME DEFAULT GETDATE()
        )
      END
    `);

    console.log('SupportTicketComments table ensured.');

    // Create KPITargets table
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='KPITargets' AND xtype='U')
      BEGIN
        CREATE TABLE KPITargets (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          KPIKey NVARCHAR(50) NOT NULL UNIQUE,
          TargetValue DECIMAL(10,2) NOT NULL,
          Label NVARCHAR(100) NOT NULL,
          UpdatedAt DATETIME DEFAULT GETDATE(),
          UpdatedBy NVARCHAR(255) NULL
        )
      END
    `);

    // Seed default KPI targets
    const kpiDefaults = [
      { key: 'collection_rate', value: 80, label: 'Collection Rate' },
      { key: 'approvals_actioned', value: 90, label: 'Approvals Actioned' },
      { key: 'facilities_visited', value: 100, label: 'Facilities Visited' },
      { key: 'reconciliation_rate', value: 90, label: 'Reconciliation Rate' },
      { key: 'outstanding_rate', value: 5, label: 'Outstanding Rate' },
      { key: 'verification_rate', value: 90, label: 'Verification Rate' },
    ];

    for (const kpi of kpiDefaults) {
      await pool.request()
        .input('key', sql.NVarChar, kpi.key)
        .input('val', sql.Decimal(10, 2), kpi.value)
        .input('label', sql.NVarChar, kpi.label)
        .query(`
          IF NOT EXISTS (SELECT Id FROM KPITargets WHERE KPIKey = @key)
            INSERT INTO KPITargets (KPIKey, TargetValue, Label) VALUES (@key, @val, @label)
        `);
    }

    console.log('KPITargets table ensured and seeded.');
    console.log('Database initialization complete!');
  } catch (err) {
    console.error('Database initialization failed:', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

initializeDatabase();
