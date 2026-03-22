/**
 * Seed 3 Admin users.
 * Run once: npx dotenv-cli -- node seed-admins.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const sql = require('mssql/msnodesqlv8');

const config = {
  connectionString:
    'Driver={ODBC Driver 18 for SQL Server};Server=' +
    process.env.DB_SERVER +
    ';Database=' +
    process.env.DB_NAME +
    ';Trusted_Connection=yes;TrustServerCertificate=yes;',
};

const admins = [
  { firstName: 'Sarah', lastName: 'van der Merwe', email: 'sarah.admin@fsa.co.za', role: 'Admin' },
  { firstName: 'James', lastName: 'Nkosi', email: 'james.admin@fsa.co.za', role: 'Admin' },
  { firstName: 'Lindiwe', lastName: 'Dlamini', email: 'lindiwe.admin@fsa.co.za', role: 'Admin' },
];

async function seed() {
  const pool = await sql.connect(config);
  const salt = await bcrypt.genSalt(10);

  for (const admin of admins) {
    // Check if already exists
    const existing = await pool.request()
      .input('email', sql.NVarChar, admin.email)
      .query('SELECT Id FROM Users WHERE LOWER(Email) = LOWER(@email)');

    if (existing.recordset.length > 0) {
      console.log(`  Already exists: ${admin.email} (Id ${existing.recordset[0].Id})`);
      continue;
    }

    const passwordHash = await bcrypt.hash('Admin@123', salt);

    await pool.request()
      .input('firstName', sql.NVarChar, admin.firstName)
      .input('lastName', sql.NVarChar, admin.lastName)
      .input('email', sql.NVarChar, admin.email)
      .input('passwordHash', sql.NVarChar, passwordHash)
      .input('role', sql.NVarChar, admin.role)
      .query(`
        INSERT INTO Users (FirstName, LastName, Email, PasswordHash, Role)
        VALUES (@firstName, @lastName, @email, @passwordHash, @role)
      `);

    console.log(`  Created: ${admin.firstName} ${admin.lastName} (${admin.email}) — Role: ${admin.role}`);
  }

  console.log('\nDone! Admin users seeded.');
  console.log('Login credentials: password is Admin@123 for all three.');
  await pool.close();
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
