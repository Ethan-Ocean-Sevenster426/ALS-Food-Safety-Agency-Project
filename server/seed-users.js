/**
 * User seed script — creates real inspectors, company admins, and basic users.
 * NO emails are sent. Run once:  cd server && npx dotenv-cli -- node seed-users.js
 */
require('dotenv').config();
const crypto = require('crypto');
const sql = require('mssql/msnodesqlv8');
const bcrypt = require('bcryptjs');

const config = {
  connectionString:
    'Driver={ODBC Driver 18 for SQL Server};Server=' +
    process.env.DB_SERVER + ';Database=' + process.env.DB_NAME +
    ';Trusted_Connection=yes;TrustServerCertificate=yes;',
};

const INSPECTORS = [
  { first: 'Ben', last: 'Visagie' },
  { first: 'Cinga', last: 'Ngongo' },
  { first: 'Corneluis', last: 'Adams' },
  { first: 'Gladys', last: 'Manganye' },
  { first: 'Hellen', last: 'Modiba' },
  { first: 'Jofred', last: 'Steyn' },
  { first: 'Kabelo', last: 'Percy' },
  { first: 'Kutlwano', last: 'Kuntwane' },
  { first: 'Lwandile', last: 'Maqina' },
  { first: 'Mokgadi', last: 'Selone' },
  { first: 'Mpeluza', last: 'Xola' },
  { first: 'Nelisa', last: 'Ntoyaphi' },
  { first: 'Neo', last: 'Noe' },
  { first: 'Sandisiwe', last: 'Dlisani' },
  { first: 'Thato', last: 'Sekhotho' },
];

const PROVINCES = [
  'Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Limpopo',
  'Mpumalanga', 'Free State', 'North West', 'Northern Cape',
];

const FIRST_NAMES = [
  'Thabo','Sipho','Nomsa','Lerato','Bongani','Zanele','Mandla','Palesa',
  'Sibusiso','Nokuthula','Kagiso','Lindiwe','Tshepo','Naledi','Mpho',
  'Thandiwe','Vusi','Nonhlanhla','Andile','Kgomotso','Sifiso','Dineo',
  'Themba','Refilwe','Nkosazana','Tumelo','Ayanda','Keitumetse','Lungile',
  'Boitumelo','Thabiso','Nombuso','Sandile','Mpumi','Nhlanhla','Zodwa',
  'Jan','Pieter','Johan','Willem','Hendrik','Marthinus','Christiaan',
  'Anna','Maria','Cornelia','Jacoba','Elsie','Martha','Johanna',
  'David','Michael','James','Sarah','Emily','Robert','Helen',
  'Precious','Gift','Blessing','Grace','Faith','Hope','Charity',
];

const LAST_NAMES = [
  'Mokoena','Nkosi','Dlamini','Zulu','Ndaba','Mahlangu','Sithole',
  'Mthembu','Khumalo','Molefe','Tau','Botha','Van der Merwe','Fourie',
  'Pretorius','Du Plessis','Venter','Steyn','Coetzee','Swanepoel',
  'Mogale','Mashaba','Phiri','Chauke','Maluleke','Mabaso','Ngwenya',
  'Radebe','Cele','Buthelezi','Vilakazi','Zwane','Langa','Xaba',
  'Mokgothla','Tshabalala','Mkhize','Mbeki','Ramaphosa','Motsepe',
  'Pillay','Govender','Naidoo','Singh','Patel','Naicker','Reddy',
];

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function seed() {
  const pool = await sql.connect(config);
  const defaultPwd = await bcrypt.hash('Password@123', 10);

  // 1. Delete old seeded inspectors (@epvs-test.com)
  const delResult = await pool.request().query(
    "DELETE FROM Users WHERE Role = 'Inspector' AND Email LIKE '%@epvs-test.com'"
  );
  console.log(`Deleted ${delResult.rowsAffected[0]} old seeded inspectors`);

  // 2. Create 15 real inspectors
  const inspectorIds = [];
  for (let i = 0; i < INSPECTORS.length; i++) {
    const insp = INSPECTORS[i];
    const email = `${insp.first}.${insp.last}@afsq.co.za`;
    const province = PROVINCES[i % PROVINCES.length];

    const existing = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT Id FROM Users WHERE Email = @email');

    if (existing.recordset.length > 0) {
      console.log(`  Inspector already exists: ${email}`);
      inspectorIds.push(existing.recordset[0].Id);
      continue;
    }

    const result = await pool.request()
      .input('fn', sql.NVarChar, insp.first)
      .input('ln', sql.NVarChar, insp.last)
      .input('email', sql.NVarChar, email)
      .input('pwd', sql.NVarChar, defaultPwd)
      .input('role', sql.NVarChar, 'Inspector')
      .input('province', sql.NVarChar, province)
      .query(`INSERT INTO Users (FirstName, LastName, Email, PasswordHash, Role, InspectorProvince)
              OUTPUT INSERTED.Id VALUES (@fn, @ln, @email, @pwd, @role, @province)`);
    inspectorIds.push(result.recordset[0].Id);
    console.log(`  Created inspector: ${insp.first} ${insp.last} (${email}) — ${province}`);
  }

  // 3. Get all facilities
  const { recordset: facilities } = await pool.request().query(
    'SELECT Id, BusinessName, Email, FacilityProvince FROM ConsolidatedMasterAbattoirDatabase ORDER BY Id'
  );
  console.log(`\nCreating company users for ${facilities.length} facilities...`);

  let companyAdmins = 0;
  let basicUsers = 0;

  for (let i = 0; i < facilities.length; i++) {
    const fac = facilities[i];

    // Determine email domain from facility email
    let domain = 'company.co.za';
    if (fac.Email && fac.Email.includes('@')) {
      domain = fac.Email.split('@')[1];
    }

    // --- Company Admin ---
    const caFirst = FIRST_NAMES[rand(0, FIRST_NAMES.length - 1)];
    const caLast = LAST_NAMES[rand(0, LAST_NAMES.length - 1)];
    const caEmail = `${caFirst.toLowerCase().replace(/\s/g, '')}.${caLast.toLowerCase().replace(/\s/g, '')}.${fac.Id}@${domain}`;

    const caResult = await pool.request()
      .input('fn', sql.NVarChar, caFirst)
      .input('ln', sql.NVarChar, caLast)
      .input('email', sql.NVarChar, caEmail)
      .input('pwd', sql.NVarChar, defaultPwd)
      .input('role', sql.NVarChar, 'Company Admin')
      .query(`INSERT INTO Users (FirstName, LastName, Email, PasswordHash, Role)
              OUTPUT INSERTED.Id VALUES (@fn, @ln, @email, @pwd, @role)`);
    companyAdmins++;

    // Link via accepted invitation
    const caToken = crypto.randomBytes(32).toString('hex');
    await pool.request()
      .input('crid', sql.Int, fac.Id)
      .input('email', sql.NVarChar, caEmail)
      .input('role', sql.NVarChar, 'Company Admin')
      .input('token', sql.NVarChar, caToken)
      .input('invBy', sql.NVarChar, 'System Seed')
      .query(`INSERT INTO Invitations (ClientRecordId, Email, Role, Token, Status, AcceptedAt, InvitedBy)
              VALUES (@crid, @email, @role, @token, 'Accepted', GETDATE(), @invBy)`);

    // --- ~40% also get a basic User ---
    if (Math.random() < 0.40) {
      const uFirst = FIRST_NAMES[rand(0, FIRST_NAMES.length - 1)];
      const uLast = LAST_NAMES[rand(0, LAST_NAMES.length - 1)];
      const uEmail = `${uFirst.toLowerCase().replace(/\s/g, '')}.${uLast.toLowerCase().replace(/\s/g, '')}.u${fac.Id}@${domain}`;

      await pool.request()
        .input('fn', sql.NVarChar, uFirst)
        .input('ln', sql.NVarChar, uLast)
        .input('email', sql.NVarChar, uEmail)
        .input('pwd', sql.NVarChar, defaultPwd)
        .input('role', sql.NVarChar, 'User')
        .query(`INSERT INTO Users (FirstName, LastName, Email, PasswordHash, Role)
                OUTPUT INSERTED.Id VALUES (@fn, @ln, @email, @pwd, @role)`);
      basicUsers++;

      const uToken = crypto.randomBytes(32).toString('hex');
      await pool.request()
        .input('crid', sql.Int, fac.Id)
        .input('email', sql.NVarChar, uEmail)
        .input('role', sql.NVarChar, 'User')
        .input('token', sql.NVarChar, uToken)
        .input('invBy', sql.NVarChar, 'System Seed')
        .query(`INSERT INTO Invitations (ClientRecordId, Email, Role, Token, Status, AcceptedAt, InvitedBy)
                VALUES (@crid, @email, @role, @token, 'Accepted', GETDATE(), @invBy)`);
    }

    if ((i + 1) % 50 === 0 || i === facilities.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${facilities.length} facilities processed`);
    }
  }

  // 4. Update inspector EPVs to reference real inspector IDs
  console.log('\n\nUpdating inspector EPVs to reference real inspectors...');
  const inspEpvs = await pool.request().query(
    "SELECT Id FROM EggProductionVerifications WHERE EPVType = 'Inspector'"
  );
  for (const epv of inspEpvs.recordset) {
    const inspId = inspectorIds[rand(0, inspectorIds.length - 1)];
    await pool.request()
      .input('id', sql.Int, epv.Id)
      .input('inspId', sql.Int, inspId)
      .query('UPDATE EggProductionVerifications SET InspectorId = @inspId WHERE Id = @id');
  }
  console.log(`Updated ${inspEpvs.recordset.length} inspector EPVs`);

  // Also update the VerifiedBy on all verified client EPVs to use real inspector names
  console.log('Updating VerifiedBy names on client EPVs...');
  for (let i = 0; i < INSPECTORS.length; i++) {
    const insp = INSPECTORS[i];
    const name = `${insp.first} ${insp.last}`;
    const inspId = inspectorIds[i];
    // Assign verified EPVs round-robin to inspectors
    await pool.request()
      .input('name', sql.NVarChar, name)
      .input('inspIdx', sql.Int, i)
      .input('total', sql.Int, INSPECTORS.length)
      .query(`UPDATE EggProductionVerifications
              SET VerifiedBy = @name
              WHERE IsVerified = 1 AND EPVType = 'Client'
              AND (Id % @total) = @inspIdx`);
  }
  console.log('Done updating VerifiedBy names');

  // Final summary
  const totalUsers = await pool.request().query(
    'SELECT Role, COUNT(*) as cnt FROM Users GROUP BY Role ORDER BY Role'
  );
  console.log('\n========================================');
  console.log('USER SEED SUMMARY');
  console.log('========================================');
  totalUsers.recordset.forEach(r => console.log(`  ${r.Role}: ${r.cnt}`));
  console.log(`  New Company Admins: ${companyAdmins}`);
  console.log(`  New Basic Users: ${basicUsers}`);
  console.log(`  Default password: Password@123`);
  console.log('========================================');
  console.log('NO emails sent.');

  process.exit();
}

seed().catch(e => { console.error('Seed error:', e); process.exit(1); });
