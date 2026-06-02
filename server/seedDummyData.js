const sql = require('mssql/msnodesqlv8');
const crypto = require('crypto');
require('dotenv').config();

const connStr = `Driver={ODBC Driver 18 for SQL Server};Server=${process.env.DB_SERVER};Database=${process.env.DB_NAME};Trusted_Connection=Yes;TrustServerCertificate=Yes;`;

const PROVINCES = ['Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Free State', 'Limpopo', 'Mpumalanga', 'North West', 'Eastern Cape', 'Northern Cape'];
const FACILITY_TYPES = ['Egg Producer', 'Egg Packer', 'Hatchery', 'Pulp Producer', 'Mixed'];
const TOWNS = ['Johannesburg', 'Cape Town', 'Durban', 'Bloemfontein', 'Pretoria', 'Polokwane', 'Nelspruit', 'Rustenburg', 'Port Elizabeth', 'Kimberley', 'Stellenbosch', 'Pietermaritzburg', 'Centurion', 'Sandton', 'Midrand'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function seed() {
  const pool = await sql.connect({ connectionString: connStr });
  console.log('Connected to database.');

  // --- 1. Create 25 client records ---
  const clientIds = [];
  const businessNames = [
    'Golden Egg Farms', 'Sunrise Poultry', 'Cape Egg Packers', 'Highveld Hatcheries',
    'Free State Eggs', 'KZN Egg Producers', 'Limpopo Layers', 'Mpumalanga Poultry Co',
    'North West Eggs', 'Eastern Egg Supply', 'Karoo Egg Farm', 'Vaalwater Poultry',
    'Midlands Egg Co', 'Bushveld Layers', 'Protea Egg Farm', 'Atlantic Poultry',
    'Kalahari Eggs', 'Lowveld Egg Producers', 'Sandveld Poultry', 'Berg River Eggs',
    'Waterberg Layers', 'Magalies Egg Farm', 'Southern Cross Poultry', 'Table Bay Eggs',
    'Valley Egg Producers'
  ];

  for (let i = 0; i < 25; i++) {
    const province = PROVINCES[i % PROVINCES.length];
    const town = TOWNS[i % TOWNS.length];
    const result = await pool.request()
      .input('bn', sql.NVarChar, businessNames[i])
      .input('ac', sql.NVarChar, `ACC-${String(i + 1).padStart(3, '0')}`)
      .input('email', sql.NVarChar, `info@${businessNames[i].toLowerCase().replace(/\s+/g, '')}.co.za`)
      .input('town', sql.NVarChar, town)
      .input('ft', sql.NVarChar, pick(FACILITY_TYPES))
      .input('fp', sql.NVarChar, province)
      .input('crn', sql.NVarChar, `${rand(1000, 9999)}/${rand(100000, 999999)}/07`)
      .input('pa', sql.NVarChar, `${rand(1, 999)} ${pick(['Main', 'Church', 'Voortrekker', 'Long', 'Adderley'])} Street, ${town}`)
      .input('vat', sql.NVarChar, `4${rand(100000000, 999999999)}`)
      .input('aon', sql.NVarChar, `${pick(['Jan', 'Piet', 'Johan', 'André', 'Willem', 'Maria', 'Susan', 'Anna'])} ${pick(['van der Merwe', 'Botha', 'Visser', 'Smit', 'Pretorius', 'Nel', 'Fourie', 'Coetzee'])}`)
      .input('aoc', sql.NVarChar, `08${rand(10000000, 99999999)}`)
      .input('aoe', sql.NVarChar, `owner@${businessNames[i].toLowerCase().replace(/\s+/g, '')}.co.za`)
      .input('acn', sql.NVarChar, `${pick(['Liesl', 'Karen', 'Marié', 'Rina', 'Elmarie'])} ${pick(['Jansen', 'du Plessis', 'Swanepoel', 'Venter', 'Steyn'])}`)
      .input('act', sql.NVarChar, `01${rand(1000000, 9999999)}`)
      .input('ace', sql.NVarChar, `accounts@${businessNames[i].toLowerCase().replace(/\s+/g, '')}.co.za`)
      .input('amn', sql.NVarChar, `${pick(['Thabo', 'Sipho', 'Bongani', 'Pieter', 'Hendrik'])} ${pick(['Molefe', 'Dlamini', 'Nkosi', 'van Wyk', 'Joubert'])}`)
      .input('amc', sql.NVarChar, `07${rand(10000000, 99999999)}`)
      .input('ame', sql.NVarChar, `manager@${businessNames[i].toLowerCase().replace(/\s+/g, '')}.co.za`)
      .input('epvcs', sql.NVarChar, i < 20 ? 'On EPV Cycle' : null)
      .query(`INSERT INTO ConsolidatedMasterAbattoirDatabase
        (BusinessName, AccountCode, Email, Town, FacilityType, FacilityProvince,
         CompanyRegNumber, PhysicalAddress, VATNumber,
         AbattoirOwnerName, AbattoirOwnerCell, AbattoirOwnerEmail,
         AccountsContactName, AccountsTelephone, AccountsEmail,
         AbattoirManagerName, AbattoirManagerCell, AbattoirManagerEmail,
         EPVCycleStatus)
        OUTPUT INSERTED.Id
        VALUES (@bn, @ac, @email, @town, @ft, @fp, @crn, @pa, @vat,
                @aon, @aoc, @aoe, @acn, @act, @ace, @amn, @amc, @ame, @epvcs)`);
    clientIds.push(result.recordset[0].Id);
  }
  console.log(`Created ${clientIds.length} client records.`);

  // --- 2. Create Company Admin invitations (accepted) for 20 of 25 clients ---
  for (let i = 0; i < 20; i++) {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.request()
      .input('crid', sql.Int, clientIds[i])
      .input('email', sql.NVarChar, `admin@${businessNames[i].toLowerCase().replace(/\s+/g, '')}.co.za`)
      .input('role', sql.NVarChar, 'Company Admin')
      .input('token', sql.NVarChar, token)
      .input('invitedBy', sql.NVarChar, 'Ethan Sevenster')
      .query(`INSERT INTO Invitations (ClientRecordId, Email, Role, Token, InvitedBy, Status, AcceptedAt)
              VALUES (@crid, @email, @role, @token, @invitedBy, 'Accepted', DATEADD(day, -${rand(10, 90)}, GETDATE()))`);
  }
  // 3 pending invitations
  for (let i = 20; i < 23; i++) {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.request()
      .input('crid', sql.Int, clientIds[i])
      .input('email', sql.NVarChar, `admin@${businessNames[i].toLowerCase().replace(/\s+/g, '')}.co.za`)
      .input('role', sql.NVarChar, 'Company Admin')
      .input('token', sql.NVarChar, token)
      .input('invitedBy', sql.NVarChar, 'Ethan Sevenster')
      .query(`INSERT INTO Invitations (ClientRecordId, Email, Role, Token, InvitedBy, Status)
              VALUES (@crid, @email, @role, @token, @invitedBy, 'Pending')`);
  }
  console.log('Created invitations (20 accepted, 3 pending).');

  // --- 3. Create Inspector user ---
  const bcrypt = require('bcryptjs');
  const inspHash = await bcrypt.hash('inspector123', 10);
  await pool.request()
    .input('fn', sql.NVarChar, 'James')
    .input('ln', sql.NVarChar, 'Inspector')
    .input('email', sql.NVarChar, 'james@epvs.co.za')
    .input('ph', sql.NVarChar, inspHash)
    .query(`IF NOT EXISTS (SELECT Id FROM Users WHERE Email = @email)
            INSERT INTO Users (FirstName, LastName, Email, PasswordHash, Role, IsActive, InspectorProvince)
            VALUES (@fn, @ln, @email, @ph, 'Inspector', 1, 'Gauteng')`);

  // Create Admin user
  const adminHash = await bcrypt.hash('admin123', 10);
  await pool.request()
    .input('fn', sql.NVarChar, 'Sarah')
    .input('ln', sql.NVarChar, 'Admin')
    .input('email', sql.NVarChar, 'sarah@epvs.co.za')
    .input('ph', sql.NVarChar, adminHash)
    .query(`IF NOT EXISTS (SELECT Id FROM Users WHERE Email = @email)
            INSERT INTO Users (FirstName, LastName, Email, PasswordHash, Role, IsActive)
            VALUES (@fn, @ln, @email, @ph, 'Admin', 1)`);
  console.log('Created Inspector and Admin users.');

  // --- 4. Create EPVs for the last 4 months ---
  const MONTHS = [
    { m: 2, y: 2026 },
    { m: 3, y: 2026 },
    { m: 4, y: 2026 },
    { m: 5, y: 2026 },
  ];

  let epvCount = 0;
  for (const { m, y } of MONTHS) {
    // 15-20 clients get EPVs each month (from the 20 on-cycle)
    const count = rand(15, 20);
    for (let i = 0; i < count; i++) {
      const cid = clientIds[i];
      const token = crypto.randomBytes(32).toString('hex');
      const ref = `EPV-${y}-${String(m).padStart(2, '0')}-${String(epvCount + 1).padStart(4, '0')}`;
      const isCompleted = m < 5 || (m === 5 && i < 12); // Most completed except some May ones
      const openingStock = rand(5000, 50000);
      const eggsProduced = rand(10000, 80000);
      const graded = rand(0, 5000);
      const ungraded = rand(0, 3000);
      const transferred = rand(0, 2000);
      const marketReturns = rand(0, 1000);
      const machineLoss = rand(0, 500);
      const sentToPulp = rand(0, 3000);
      const destroyed = rand(0, 200);
      const exported = rand(0, 1000);
      const soldToTrade = rand(5000, 40000);
      const soldToStaff = rand(0, 500);
      const soldFarmStall = rand(0, 1000);
      const transferredOut = rand(0, 1500);
      const totalD = soldToTrade + soldToStaff + soldFarmStall;
      const levyAmount = totalD * 0.02;
      const closingStock = openingStock + eggsProduced + graded + ungraded + transferred
        - marketReturns - machineLoss - sentToPulp - destroyed - exported
        - soldToTrade - soldToStaff - soldFarmStall - transferredOut;
      const actualClosing = closingStock + rand(-500, 500);
      const pulpOpening = rand(0, 5000);
      const pulpPurchased = rand(0, 2000);
      const pulpConverted = rand(0, sentToPulp);
      const pulpSoldTrade = rand(0, 3000);
      const pulpSoldProd = rand(0, 500);
      const pulpLoss = rand(0, 200);

      const isReconciled = isCompleted && Math.random() > 0.3 ? 1 : 0;
      const isVerified = isCompleted && Math.random() > 0.2 ? 1 : 0;

      await pool.request()
        .input('crid', sql.Int, cid)
        .input('pm', sql.Int, m)
        .input('py', sql.Int, y)
        .input('token', sql.NVarChar, token)
        .input('ref', sql.NVarChar, ref)
        .input('status', sql.NVarChar, isCompleted ? 'Completed' : 'Pending')
        .input('bn', sql.NVarChar, businessNames[i])
        .input('ft', sql.NVarChar, pick(FACILITY_TYPES))
        .input('fp', sql.NVarChar, PROVINCES[i % PROVINCES.length])
        .input('ea', sql.NVarChar, `info@${businessNames[i].toLowerCase().replace(/\s+/g, '')}.co.za`)
        .input('apn', sql.NVarChar, `Owner ${i + 1}`)
        .input('os', sql.Decimal(18, 2), openingStock)
        .input('ep', sql.Int, eggsProduced)
        .input('gp', sql.Int, graded)
        .input('up', sql.Int, ungraded)
        .input('tfp', sql.Int, transferred)
        .input('mr', sql.Int, marketReturns)
        .input('ml', sql.Int, machineLoss)
        .input('stp', sql.Int, sentToPulp)
        .input('dest', sql.Int, destroyed)
        .input('exp', sql.Int, exported)
        .input('stt', sql.Int, soldToTrade)
        .input('sts', sql.Int, soldToStaff)
        .input('stf', sql.Int, soldFarmStall)
        .input('top2', sql.Int, transferredOut)
        .input('acs', sql.Decimal(18, 2), actualClosing)
        .input('po', sql.Decimal(18, 2), pulpOpening)
        .input('pp', sql.Decimal(18, 2), pulpPurchased)
        .input('pc', sql.Decimal(18, 2), pulpConverted)
        .input('pst', sql.Decimal(18, 2), pulpSoldTrade)
        .input('psp', sql.Decimal(18, 2), pulpSoldProd)
        .input('pcl', sql.Decimal(18, 2), pulpLoss)
        .input('levy', sql.Decimal(18, 4), levyAmount)
        .input('cs', sql.Decimal(18, 2), closingStock)
        .input('lg', sql.Decimal(18, 2), actualClosing - closingStock)
        .input('ir', sql.Bit, isReconciled)
        .input('ra', sql.Decimal(18, 2), isReconciled ? levyAmount : (Math.random() > 0.5 ? levyAmount * 0.5 : 0))
        .input('iv', sql.Bit, isVerified)
        .query(`INSERT INTO EggProductionVerifications
          (ClientRecordId, PeriodMonth, PeriodYear, Token, ReferenceNumber, Status, EPVType,
           BusinessName, FacilityType, FacilityProvince, EmailAddress, AuthorizedPersonName,
           OpeningStock, EggsProducedDuringMonth, GradedEggsPurchased, UngradedEggsPurchased,
           TransferredOrPurchasedFromProducers,
           MarketReturns, MachineLoss, SentToPulp, Destroyed, Exported,
           SoldToTrade, SoldToStaff, SoldThroughFarmStall, TransferredToOtherProducers,
           ActualClosingStock,
           PulpOpeningStock, PulpPurchased, PulpConverted, PulpSoldToTrade, PulpSoldToProducers, PulpConversionLoss,
           LevyAmount, ClosingStock, LossGain,
           TotalB, TotalC, TotalD, TotalE,
           IsReconciled, ReconciledAmount, IsVerified,
           CompletedBy, CompletedAt)
          VALUES
          (@crid, @pm, @py, @token, @ref, @status, 'Client',
           @bn, @ft, @fp, @ea, @apn,
           @os, @ep, @gp, @up, @tfp,
           @mr, @ml, @stp, @dest, @exp,
           @stt, @sts, @stf, @top2,
           @acs,
           @po, @pp, @pc, @pst, @psp, @pcl,
           @levy, @cs, @lg,
           ${graded + ungraded}, ${marketReturns + machineLoss + sentToPulp + destroyed + exported}, ${totalD}, ${transferredOut - transferred},
           @ir, @ra, @iv,
           ${isCompleted ? "'System'" : "NULL"}, ${isCompleted ? "DATEADD(day, -" + rand(1, 25) + ", GETDATE())" : "NULL"})`);
      epvCount++;
    }
  }
  console.log(`Created ${epvCount} EPV records across 4 months.`);

  // --- 5. Create support tickets ---
  // Get Ethan's user ID
  const ethanResult = await pool.request().query("SELECT TOP 1 Id FROM Users WHERE Email = 'ethan.sevenster@moc-pty.com'");
  const ethanId = ethanResult.recordset[0]?.Id || 2;

  const tickets = [
    { catId: 1, subject: 'Cannot access EPV form', priority: 'High', status: 'Open' },
    { catId: 5, subject: 'EPV data needs amendment for March', priority: 'Medium', status: 'In Progress' },
    { catId: 8, subject: 'Payment not reflecting after POP upload', priority: 'High', status: 'Open' },
    { catId: 12, subject: 'Dashboard totals seem incorrect', priority: 'Low', status: 'Resolved' },
    { catId: 17, subject: 'How do I export EPV history?', priority: 'Low', status: 'Closed' },
  ];

  for (const t of tickets) {
    await pool.request()
      .input('catId', sql.Int, t.catId)
      .input('catType', sql.NVarChar, 'Administration')
      .input('subject', sql.NVarChar, t.subject)
      .input('desc', sql.NVarChar, `Dummy ticket: ${t.subject}`)
      .input('priority', sql.NVarChar, t.priority)
      .input('status', sql.NVarChar, t.status)
      .input('userId', sql.Int, ethanId)
      .query(`INSERT INTO SupportTickets (CategoryId, CategoryType, Subject, Description, Priority, Status, CreatedByUserId)
              VALUES (@catId, @catType, @subject, @desc, @priority, @status, @userId)`);
  }
  console.log(`Created ${tickets.length} support tickets.`);

  // --- 6. Some audit log entries ---
  for (let i = 0; i < 5; i++) {
    await pool.request()
      .input('rid', sql.Int, clientIds[i])
      .input('fn', sql.NVarChar, '_CREATED')
      .input('nv', sql.NVarChar, `New record: ${businessNames[i]}`)
      .input('cb', sql.NVarChar, 'Ethan Sevenster')
      .query(`INSERT INTO ClientAuditLog (RecordId, FieldName, OldValue, NewValue, ChangedBy)
              VALUES (@rid, @fn, '', @nv, @cb)`);
  }
  console.log('Created audit log entries.');

  console.log('\nDummy data seeded successfully!');
  await pool.close();
  process.exit(0);
}

seed().catch(e => { console.error('Seed error:', e.message, e); process.exit(1); });
