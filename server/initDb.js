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
          CreatedAt DATETIME DEFAULT GETDATE()
        )
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
          INSERT INTO Users (FirstName, LastName, Email, PasswordHash)
          VALUES (@firstName, @lastName, @email, @passwordHash)
        END
      `);

    console.log('Default user "Anthony" created (anthony@epvs.com).');
    console.log('Database initialization complete!');
  } catch (err) {
    console.error('Database initialization failed:', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

initializeDatabase();
