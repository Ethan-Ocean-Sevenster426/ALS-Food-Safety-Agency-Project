const sql = require('mssql/msnodesqlv8');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
require('dotenv').config();

const connStr = `Driver={ODBC Driver 18 for SQL Server};Server=${process.env.DB_SERVER};Database=${process.env.DB_NAME};Trusted_Connection=Yes;TrustServerCertificate=Yes;`;

async function seed() {
  const pool = await sql.connect({ connectionString: connStr });
  console.log('Connected to database.');

  // Ensure ClientRecordId column on Users table
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'ClientRecordId')
    ALTER TABLE Users ADD ClientRecordId INT NULL
  `);
  console.log('Users.ClientRecordId ensured.');

  // Clean up any previous Barnel data
  const existing = await pool.request()
    .input('bn', sql.NVarChar, 'Barnel Investments t/a Barberton Abattoir')
    .query(`SELECT Id FROM ConsolidatedMasterAbattoirDatabase WHERE BusinessName = @bn`);
  for (const row of existing.recordset) {
    await pool.request().input('cid', sql.Int, row.Id).query(`DELETE FROM EggProductionVerifications WHERE ClientRecordId = @cid`);
    await pool.request().input('cid', sql.Int, row.Id).query(`DELETE FROM Invitations WHERE ClientRecordId = @cid`);
    await pool.request().input('cid', sql.Int, row.Id).query(`DELETE FROM ConsolidatedMasterAbattoirDatabase WHERE Id = @cid`);
  }
  await pool.request().input('email', sql.NVarChar, 'eddie@barnelinvest.co.za').query(`DELETE FROM Users WHERE Email = @email`);
  console.log('Cleaned up any previous Barnel data.');

  // --- 1. Client record ---
  const clientResult = await pool.request()
    .input('bn', sql.NVarChar, 'Barnel Investments t/a Barberton Abattoir')
    .input('email', sql.NVarChar, 'eddie@barnelinvest.co.za')
    .input('town', sql.NVarChar, 'Barberton')
    .input('ft', sql.NVarChar, 'Producer')
    .input('fp', sql.NVarChar, 'Mpumalanga')
    .input('crn', sql.NVarChar, '1968/014849/07')
    .input('pa', sql.NVarChar, '6 General Street, Barberton, 1300')
    .input('vat', sql.NVarChar, '4940121744')
    .input('aon', sql.NVarChar, 'Eddie Viljoen')
    .input('aoc', sql.NVarChar, '0828043386')
    .input('aoe', sql.NVarChar, 'eddie@barnelinvest.co.za')
    .input('acn', sql.NVarChar, 'Johan Ellis')
    .input('act', sql.NVarChar, '0843007204')
    .input('ace', sql.NVarChar, 'admin@barnelinvest.co.za')
    .input('amn', sql.NVarChar, 'Eddie Viljoen')
    .input('amc', sql.NVarChar, '0828043386')
    .input('ame', sql.NVarChar, 'eddie@barnelinvest.co.za')
    .input('epvcs', sql.NVarChar, 'On EPV Cycle')
    .query(`INSERT INTO ConsolidatedMasterAbattoirDatabase
      (BusinessName, Email, Town, FacilityType, FacilityProvince,
       CompanyRegNumber, PhysicalAddress, VATNumber,
       AbattoirOwnerName, AbattoirOwnerCell, AbattoirOwnerEmail,
       AccountsContactName, AccountsTelephone, AccountsEmail,
       AbattoirManagerName, AbattoirManagerCell, AbattoirManagerEmail,
       EPVCycleStatus)
      OUTPUT INSERTED.Id
      VALUES (@bn, @email, @town, @ft, @fp, @crn, @pa, @vat,
              @aon, @aoc, @aoe, @acn, @act, @ace, @amn, @amc, @ame, @epvcs)`);
  const clientId = clientResult.recordset[0].Id;
  console.log(`Created client record: Barnel Investments (Id=${clientId})`);

  // --- 2. User: Liezl Viljoen (Company Admin) ---
  const hash = await bcrypt.hash('Barnel2026!', 10);
  await pool.request()
    .input('fn', sql.NVarChar, 'Liezl')
    .input('ln', sql.NVarChar, 'Viljoen')
    .input('email', sql.NVarChar, 'eddie@barnelinvest.co.za')
    .input('ph', sql.NVarChar, hash)
    .input('crid', sql.Int, clientId)
    .query(`INSERT INTO Users (FirstName, LastName, Email, PasswordHash, Role, IsActive, ClientRecordId)
            VALUES (@fn, @ln, @email, @ph, 'Company Admin', 1, @crid)`);
  const userResult = await pool.request()
    .input('email', sql.NVarChar, 'eddie@barnelinvest.co.za')
    .query(`SELECT Id FROM Users WHERE Email = @email`);
  const userId = userResult.recordset[0]?.Id;
  console.log(`User Liezl Viljoen created (Id=${userId})`);

  // --- 3. Accepted invitation for Liezl ---
  const acceptedToken = crypto.randomBytes(32).toString('hex');
  await pool.request()
    .input('crid', sql.Int, clientId)
    .input('email', sql.NVarChar, 'eddie@barnelinvest.co.za')
    .input('role', sql.NVarChar, 'Company Admin')
    .input('token', sql.NVarChar, acceptedToken)
    .input('invitedBy', sql.NVarChar, 'Anthony Penzes')
    .query(`INSERT INTO Invitations (ClientRecordId, Email, Role, Token, InvitedBy, Status, AcceptedAt)
            VALUES (@crid, @email, @role, @token, @invitedBy, 'Accepted', '2026-05-25 12:33:35')`);
  console.log('Created accepted invitation for Liezl.');

  // --- 4. Two pending invitations ---
  for (const inv of [
    { email: 'johan@barnelinvest.co.za', role: 'Company User' },
    { email: 'admin@barnelinvest.co.za', role: 'Company User' },
  ]) {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.request()
      .input('crid', sql.Int, clientId)
      .input('email', sql.NVarChar, inv.email)
      .input('role', sql.NVarChar, inv.role)
      .input('token', sql.NVarChar, token)
      .input('invitedBy', sql.NVarChar, 'Anthony Penzes')
      .query(`INSERT INTO Invitations (ClientRecordId, Email, Role, Token, InvitedBy, Status)
              VALUES (@crid, @email, @role, @token, @invitedBy, 'Pending')`);
  }
  console.log('Created 2 pending invitations.');

  // --- 5. EPV for April 2026 (ref 2026-04-0003) ---
  const apr_token = crypto.randomBytes(32).toString('hex');
  await pool.request()
    .input('crid', sql.Int, clientId)
    .input('pm', sql.Int, 4)
    .input('py', sql.Int, 2026)
    .input('token', sql.NVarChar, apr_token)
    .input('ref', sql.NVarChar, '2026-04-0003')
    .input('status', sql.NVarChar, 'Complete')
    .input('bn', sql.NVarChar, 'Barnel Investments t/a Barberton Abattoir')
    .input('ft', sql.NVarChar, 'Producer')
    .input('fp', sql.NVarChar, 'Mpumalanga')
    .input('ea', sql.NVarChar, 'eddie@barnelinvest.co.za')
    .input('apn', sql.NVarChar, 'Eddie Viljoen')
    .query(`INSERT INTO EggProductionVerifications
      (ClientRecordId, PeriodMonth, PeriodYear, Token, ReferenceNumber, Status, EPVType,
       BusinessName, FacilityType, FacilityProvince, EmailAddress, AuthorizedPersonName)
      VALUES (@crid, @pm, @py, @token, @ref, @status, 'Client',
              @bn, @ft, @fp, @ea, @apn)`);
  console.log('Created EPV: 2026-04-0003 (Apr 2026, Complete)');

  // --- 6. EPV for May 2026 (ref 2026-05-0009) ---
  const may_token = crypto.randomBytes(32).toString('hex');
  await pool.request()
    .input('crid', sql.Int, clientId)
    .input('pm', sql.Int, 5)
    .input('py', sql.Int, 2026)
    .input('token', sql.NVarChar, may_token)
    .input('ref', sql.NVarChar, '2026-05-0009')
    .input('status', sql.NVarChar, 'Complete')
    .input('bn', sql.NVarChar, 'Barnel Investments t/a Barberton Abattoir')
    .input('ft', sql.NVarChar, 'Producer')
    .input('fp', sql.NVarChar, 'Mpumalanga')
    .input('ea', sql.NVarChar, 'eddie@barnelinvest.co.za')
    .input('apn', sql.NVarChar, 'Eddie Viljoen')
    .query(`INSERT INTO EggProductionVerifications
      (ClientRecordId, PeriodMonth, PeriodYear, Token, ReferenceNumber, Status, EPVType,
       BusinessName, FacilityType, FacilityProvince, EmailAddress, AuthorizedPersonName)
      VALUES (@crid, @pm, @py, @token, @ref, @status, 'Client',
              @bn, @ft, @fp, @ea, @apn)`);
  console.log('Created EPV: 2026-05-0009 (May 2026, Complete)');

  console.log('\nBarnel Investments data seeded successfully!');
  console.log(`Client ID: ${clientId}`);
  console.log(`User: Liezl Viljoen / eddie@barnelinvest.co.za / password: Barnel2026!`);
  await pool.close();
  process.exit(0);
}

seed().catch(e => { console.error('Error:', e.message); process.exit(1); });
