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
      { name: 'Access/Permission Issue', type: 'Administration', sortOrder: 1 },
      { name: 'Administration', type: 'Administration', sortOrder: 2 },
      { name: 'Question/Help', type: 'Administration', sortOrder: 3 },
      { name: 'Report Generation/Export Issue', type: 'IT', sortOrder: 4 },
      { name: 'Data Import/Export Issue', type: 'Administration', sortOrder: 5 },
      { name: 'Feature Request', type: 'IT', sortOrder: 6 },
      { name: 'Performance/Speed Issue', type: 'IT', sortOrder: 7 },
      { name: 'System Error/Bug', type: 'IT', sortOrder: 8 },
      { name: 'Other', type: 'Administration', sortOrder: 9 },
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
    console.log('Database initialization complete!');
  } catch (err) {
    console.error('Database initialization failed:', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

initializeDatabase();
