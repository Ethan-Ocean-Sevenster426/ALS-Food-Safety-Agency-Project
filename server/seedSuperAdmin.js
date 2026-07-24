const sql = require('mssql/msnodesqlv8');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const connStr = `Driver={ODBC Driver 18 for SQL Server};Server=${process.env.DB_SERVER};Database=${process.env.DB_NAME};Trusted_Connection=Yes;TrustServerCertificate=Yes;`;

async function seed() {
  const pool = await sql.connect({ connectionString: connStr });
  console.log('Connected to database.');

  const email = 'superadmin@fsa.co.za';

  // Check if user already exists
  const existing = await pool.request()
    .input('email', sql.NVarChar, email)
    .query(`SELECT Id FROM Users WHERE Email = @email`);

  if (existing.recordset.length > 0) {
    console.log(`Super Admin user already exists (Id=${existing.recordset[0].Id}). No changes made.`);
    await pool.close();
    process.exit(0);
  }

  const hash = await bcrypt.hash('SuperAdmin2026!', 10);
  await pool.request()
    .input('fn', sql.NVarChar, 'Super')
    .input('ln', sql.NVarChar, 'Admin')
    .input('email', sql.NVarChar, email)
    .input('ph', sql.NVarChar, hash)
    .query(`INSERT INTO Users (FirstName, LastName, Email, PasswordHash, Role, IsActive)
            VALUES (@fn, @ln, @email, @ph, 'Super Admin', 1)`);

  const userResult = await pool.request()
    .input('email', sql.NVarChar, email)
    .query(`SELECT Id FROM Users WHERE Email = @email`);
  const userId = userResult.recordset[0]?.Id;

  console.log('\nSuper Admin user created successfully!');
  console.log(`User ID: ${userId}`);
  console.log(`Email: ${email}`);
  console.log(`Password: SuperAdmin2026!`);
  console.log(`Role: Super Admin`);

  await pool.close();
  process.exit(0);
}

seed().catch(e => { console.error('Error:', e.message); process.exit(1); });
