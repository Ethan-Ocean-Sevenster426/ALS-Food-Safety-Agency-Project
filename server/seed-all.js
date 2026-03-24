/**
 * Full re-seed script:
 *   1. Import Test.xlsx into ConsolidatedMasterAbattoirDatabase (replaces old data)
 *   2. Clean old Company Admin / User accounts (keep Super Admin, Admin, Inspector)
 *   3. Seed Company Admins and Users for each facility
 *   4. Seed EPV data (Jan 2025 – Mar 2026) with same parameters as seed-demo.js
 *
 * NO EMAILS ARE SENT.
 * Run:  cd server && node seed-all.js
 */
require('dotenv').config();
const crypto = require('crypto');
const sql = require('mssql/msnodesqlv8');
const bcrypt = require('bcryptjs');
const xlsx = require('xlsx');
const path = require('path');

const config = {
  connectionString:
    'Driver={ODBC Driver 18 for SQL Server};Server=' +
    process.env.DB_SERVER + ';Database=' + process.env.DB_NAME +
    ';Trusted_Connection=yes;TrustServerCertificate=yes;',
  requestTimeout: 180000,
};

const LEVY_RATE = 0.018;

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

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randDec(min, max) {
  return +(Math.random() * (max - min) + min).toFixed(2);
}

function mapFacilityType(raw) {
  if (!raw) return 'Producer';
  const lower = raw.toLowerCase().trim();
  if (lower === 'farm' || lower === 'egg producers') return 'Producer';
  if (lower === 're-packer') return 'Re-Packer';
  if (lower === 'production plant') return 'Producer';
  return 'Producer';
}

function mapProvince(raw) {
  if (!raw || raw === 'TBC' || raw === 'None' || raw.trim() === '') {
    return PROVINCES[rand(0, PROVINCES.length - 1)];
  }
  return raw.trim();
}

async function seed() {
  const pool = await sql.connect(config);

  // ============================================================
  // PHASE 1: Import Test.xlsx into ConsolidatedMasterAbattoirDatabase
  // ============================================================
  console.log('=== PHASE 1: Importing Test.xlsx ===');

  const xlsxPath = path.join(__dirname, '..', 'Test.xlsx');
  const wb = xlsx.readFile(xlsxPath);
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  console.log(`Read ${rows.length} rows from Test.xlsx`);

  // Clear dependent data first (FK order)
  console.log('Clearing old data...');
  try { await pool.request().query('DELETE FROM EPVInvoices'); } catch(e) {}
  try { await pool.request().query('DELETE FROM EPVAuditLog'); } catch(e) {}
  try { await pool.request().query('DELETE FROM EmailSendLog'); } catch(e) {}
  await pool.request().query('DELETE FROM EggProductionVerifications');
  await pool.request().query('DELETE FROM Invitations');
  await pool.request().query('DELETE FROM ConsolidatedMasterAbattoirDatabase');
  console.log('Cleared old facility, EPV, and invitation data');

  // Delete Company Admin and User accounts (keep Super Admin, Admin, Inspector)
  const delUsers = await pool.request().query(
    "DELETE FROM Users WHERE Role IN ('Company Admin', 'User')"
  );
  console.log(`Deleted ${delUsers.rowsAffected[0]} Company Admin/User accounts`);

  // Insert facilities from Test.xlsx
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const businessName = (row['Business Name'] || '').trim();
    const accountCode = (row['Internal Account Code'] || '').trim();
    const facilityType = mapFacilityType(row['Facility Type']);
    const province = mapProvince(row['Province']);
    const rawEmail = (row['Representative Email Adress'] || '').trim();
    const email = (rawEmail && rawEmail !== 'None') ? rawEmail : '';

    await pool.request()
      .input('bn', sql.NVarChar, businessName)
      .input('ac', sql.NVarChar, accountCode)
      .input('cid', sql.NVarChar, accountCode)
      .input('ft', sql.NVarChar, facilityType)
      .input('fp', sql.NVarChar, province)
      .input('email', sql.NVarChar, email)
      .query(`INSERT INTO ConsolidatedMasterAbattoirDatabase
              (BusinessName, AccountCode, ClientID, FacilityType, FacilityProvince, Email)
              VALUES (@bn, @ac, @cid, @ft, @fp, @email)`);

    if ((i + 1) % 100 === 0 || i === rows.length - 1) {
      process.stdout.write(`\r  Imported ${i + 1}/${rows.length} facilities`);
    }
  }
  console.log('\n  Facility import complete');

  // ============================================================
  // PHASE 2: Seed Company Admins and Users
  // ============================================================
  console.log('\n=== PHASE 2: Seeding Company Admins & Users ===');

  const defaultPwd = await bcrypt.hash('Password@123', 10);

  const { recordset: facilities } = await pool.request().query(
    'SELECT Id, BusinessName, FacilityType, Email, FacilityProvince FROM ConsolidatedMasterAbattoirDatabase ORDER BY Id'
  );
  console.log(`Creating users for ${facilities.length} facilities...`);

  // Get inspector IDs for later
  const inspResult = await pool.request().query(
    "SELECT Id, FirstName, LastName FROM Users WHERE Role = 'Inspector' ORDER BY Id"
  );
  const inspectorIds = inspResult.recordset.map(r => r.Id);
  console.log(`Found ${inspectorIds.length} existing inspectors`);

  let companyAdmins = 0;
  let basicUsers = 0;

  for (let i = 0; i < facilities.length; i++) {
    const fac = facilities[i];

    let domain = 'company.co.za';
    if (fac.Email && fac.Email.includes('@')) {
      domain = fac.Email.split('@')[1];
    }

    // Company Admin
    const caFirst = FIRST_NAMES[rand(0, FIRST_NAMES.length - 1)];
    const caLast = LAST_NAMES[rand(0, LAST_NAMES.length - 1)];
    const caEmail = `${caFirst.toLowerCase().replace(/\s/g, '')}.${caLast.toLowerCase().replace(/\s/g, '')}.${fac.Id}@${domain}`;

    await pool.request()
      .input('fn', sql.NVarChar, caFirst)
      .input('ln', sql.NVarChar, caLast)
      .input('email', sql.NVarChar, caEmail)
      .input('pwd', sql.NVarChar, defaultPwd)
      .input('role', sql.NVarChar, 'Company Admin')
      .query(`INSERT INTO Users (FirstName, LastName, Email, PasswordHash, Role)
              VALUES (@fn, @ln, @email, @pwd, @role)`);
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

    // ~40% also get a basic User
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
                VALUES (@fn, @ln, @email, @pwd, @role)`);
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

    if ((i + 1) % 100 === 0 || i === facilities.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${facilities.length} facilities processed`);
    }
  }
  console.log(`\n  Company Admins: ${companyAdmins}, Basic Users: ${basicUsers}`);

  // ============================================================
  // PHASE 3: Seed EPV data (Jan 2025 – Mar 2026)
  // ============================================================
  console.log('\n=== PHASE 3: Seeding EPV data ===');

  // Visit schedule: 65% of facilities visited once per quarter
  const quarters = [
    { q: 1, year: 2025, months: [1, 2, 3] },
    { q: 2, year: 2025, months: [4, 5, 6] },
    { q: 3, year: 2025, months: [7, 8, 9] },
    { q: 4, year: 2025, months: [10, 11, 12] },
    { q: 1, year: 2026, months: [1, 2, 3] },
  ];
  const visitMap = new Map();
  for (const qDef of quarters) {
    const shuffled = [...facilities].sort(() => Math.random() - 0.5);
    const visited = shuffled.slice(0, Math.round(facilities.length * 0.65));
    for (const fac of visited) {
      const visitMonth = qDef.months[rand(0, qDef.months.length - 1)];
      visitMap.set(`${qDef.year}-${visitMonth}-${fac.Id}`, true);
    }
  }
  console.log(`Visit schedule: ${visitMap.size} visit slots`);

  // Month definitions
  const months = [
    { month: 1,  year: 2025, completionPct: 0.85, approvalPct: 1.00 },
    { month: 2,  year: 2025, completionPct: 0.85, approvalPct: 1.00 },
    { month: 3,  year: 2025, completionPct: 0.84, approvalPct: 1.00 },
    { month: 4,  year: 2025, completionPct: 0.83, approvalPct: 1.00 },
    { month: 5,  year: 2025, completionPct: 0.82, approvalPct: 1.00 },
    { month: 6,  year: 2025, completionPct: 0.81, approvalPct: 1.00 },
    { month: 7,  year: 2025, completionPct: 0.80, approvalPct: 1.00 },
    { month: 8,  year: 2025, completionPct: 0.79, approvalPct: 1.00 },
    { month: 9,  year: 2025, completionPct: 0.78, approvalPct: 1.00 },
    { month: 10, year: 2025, completionPct: 0.77, approvalPct: 1.00 },
    { month: 11, year: 2025, completionPct: 0.76, approvalPct: 1.00 },
    { month: 12, year: 2025, completionPct: 0.75, approvalPct: 1.00 },
    { month: 1,  year: 2026, completionPct: 0.55, approvalPct: 0.95 },
    { month: 2,  year: 2026, completionPct: 0.40, approvalPct: 0.95 },
    { month: 3,  year: 2026, completionPct: 0.30, approvalPct: 0.90 },
  ];

  let refCounters = {};
  let totalClient = 0;
  let totalInspector = 0;
  let totalPending = 0;
  let totalLevySum = 0;

  for (const { month, year, completionPct, approvalPct } of months) {
    const mm = String(month).padStart(2, '0');
    const key = `${year}-${mm}`;
    if (!refCounters[key]) refCounters[key] = 0;

    console.log(`\nSeeding ${key} (${(completionPct * 100).toFixed(0)}% completed, ${(approvalPct * 100).toFixed(0)}% approved)...`);

    for (let i = 0; i < facilities.length; i += 50) {
      const batch = facilities.slice(i, i + 50);

      for (const fac of batch) {
        refCounters[key]++;
        const refNum = `EPV-${year}-${mm}-${String(refCounters[key]).padStart(4, '0')}`;
        const token = crypto.randomBytes(32).toString('hex');

        const isCompleted = Math.random() < completionPct;

        // Random production data
        const openingStock = randDec(5000, 80000);
        const graded = rand(5000, 50000);
        const ungraded = rand(0, 15000);
        const totalB = graded + ungraded + openingStock;
        const marketReturns = rand(0, 800);
        const machineLoss = rand(0, 300);
        const sentToPulp = rand(500, 5000);
        const destroyed = rand(0, 200);
        const totalC = marketReturns + machineLoss + sentToPulp + destroyed;
        const soldToTrade = rand(50000, 350000);
        const exported = rand(0, 5000);
        const soldToStaff = rand(0, 1000);
        const soldFarmStall = rand(0, 3000);
        const totalD = soldToTrade + exported + soldToStaff + soldFarmStall;
        const levyAmount = +(soldToTrade * LEVY_RATE).toFixed(2);
        const transferred = rand(0, 1000);
        const closingStock = +(totalB - totalC - totalD - transferred).toFixed(2);

        // Pulp data
        const pulpOpeningStock = rand(0, 5000);
        const pulpPurchased = rand(0, 3000);
        const pulpConverted = rand(0, 2000);
        const pulpSoldToTrade = rand(5000, 55000);

        const pulpLevy = +(pulpSoldToTrade * 1.7 * LEVY_RATE).toFixed(2);
        const totalOwed = +(levyAmount + pulpLevy).toFixed(2);

        const completedDay = rand(1, 28);
        const completedAt = `${year}-${mm}-${String(completedDay).padStart(2, '0')}T${String(rand(8,17)).padStart(2,'0')}:${String(rand(0,59)).padStart(2,'0')}:00`;

        let isVerified = 0;
        let verifiedBy = null;
        let verifiedAt = null;
        let inspComment = null;
        let isRejected = false;

        if (isCompleted) {
          if (Math.random() < approvalPct) {
            if (Math.random() < 0.10) {
              isRejected = true;
              isVerified = 1;
              verifiedBy = 'Inspector (System Seed)';
              verifiedAt = completedAt;
              inspComment = 'Amounts corrected by inspector after verification.';
            } else {
              isVerified = 1;
              verifiedBy = 'Inspector (System Seed)';
              verifiedAt = completedAt;
            }
          }
        }

        const manualInspection = visitMap.has(`${year}-${month}-${fac.Id}`) ? 1 : 0;
        const status = isCompleted ? 'Completed' : 'Pending';

        await pool.request()
          .input('crid', sql.Int, fac.Id)
          .input('pm', sql.Int, month)
          .input('py', sql.Int, year)
          .input('status', sql.NVarChar, status)
          .input('token', sql.NVarChar, token)
          .input('ref', sql.NVarChar, refNum)
          .input('bn', sql.NVarChar, fac.BusinessName || '')
          .input('ft', sql.NVarChar, fac.FacilityType || '')
          .input('email', sql.NVarChar, fac.Email || '')
          .input('owner', sql.NVarChar, 'Facility Owner')
          .input('os', sql.Decimal(18,2), openingStock)
          .input('ge', sql.Int, graded)
          .input('uge', sql.Int, ungraded)
          .input('tb', sql.Decimal(18,2), totalB)
          .input('mr', sql.Int, marketReturns)
          .input('ml', sql.Int, machineLoss)
          .input('stp', sql.Int, sentToPulp)
          .input('dest', sql.Int, destroyed)
          .input('tc', sql.Decimal(18,2), totalC)
          .input('stt', sql.Int, soldToTrade)
          .input('exp', sql.Int, exported)
          .input('sts', sql.Int, soldToStaff)
          .input('stf', sql.Int, soldFarmStall)
          .input('td', sql.Decimal(18,2), totalD)
          .input('levy', sql.Decimal(18,2), levyAmount)
          .input('trans', sql.Int, transferred)
          .input('cs', sql.Decimal(18,2), Math.max(0, closingStock))
          .input('pos', sql.Decimal(18,2), pulpOpeningStock)
          .input('ppu', sql.Decimal(18,2), pulpPurchased)
          .input('pco', sql.Decimal(18,2), pulpConverted)
          .input('pst', sql.Int, pulpSoldToTrade)
          .input('ca', sql.DateTime, isCompleted ? new Date(completedAt) : null)
          .input('cb', sql.NVarChar, isCompleted ? 'Facility User' : null)
          .input('iv', sql.Bit, isVerified)
          .input('vb', sql.NVarChar, verifiedBy)
          .input('va', sql.DateTime, verifiedAt ? new Date(verifiedAt) : null)
          .input('ic', sql.NVarChar, inspComment)
          .input('mi', sql.Bit, manualInspection)
          .input('etype', sql.NVarChar, 'Client')
          .input('fp', sql.NVarChar, fac.FacilityProvince || 'Gauteng')
          .query(`
            INSERT INTO EggProductionVerifications
            (ClientRecordId, PeriodMonth, PeriodYear, Status, Token, ReferenceNumber,
             BusinessName, FacilityType, EmailAddress, AuthorizedPersonName,
             OpeningStock, GradedEggsPurchased, UngradedEggsPurchased, TotalB,
             MarketReturns, MachineLoss, SentToPulp, Destroyed, TotalC,
             SoldToTrade, Exported, SoldToStaff, SoldThroughFarmStall, TotalD,
             LevyAmount, TransferredToOtherProducers, ClosingStock,
             PulpOpeningStock, PulpPurchased, PulpConverted, PulpSoldToTrade,
             CompletedAt, CompletedBy, IsVerified, VerifiedBy, VerifiedAt,
             InspectorComment, ManualInspection, EPVType, FacilityProvince)
            VALUES
            (@crid, @pm, @py, @status, @token, @ref,
             @bn, @ft, @email, @owner,
             @os, @ge, @uge, @tb,
             @mr, @ml, @stp, @dest, @tc,
             @stt, @exp, @sts, @stf, @td,
             @levy, @trans, @cs,
             @pos, @ppu, @pco, @pst,
             @ca, @cb, @iv, @vb, @va,
             @ic, @mi, @etype, @fp)
          `);

        if (isCompleted) {
          totalClient++;
          totalLevySum += totalOwed;
        } else {
          totalPending++;
        }

        // If rejected, create inspector EPV with corrected amounts
        if (isRejected) {
          const lastId = await pool.request()
            .input('crid2', sql.Int, fac.Id)
            .input('pm2', sql.Int, month)
            .input('py2', sql.Int, year)
            .input('ref2', sql.NVarChar, refNum)
            .query("SELECT Id FROM EggProductionVerifications WHERE ClientRecordId=@crid2 AND PeriodMonth=@pm2 AND PeriodYear=@py2 AND ReferenceNumber=@ref2 AND EPVType='Client'");

          const clientEpvId = lastId.recordset[0]?.Id;
          if (clientEpvId) {
            const inspToken = crypto.randomBytes(32).toString('hex');
            refCounters[key]++;
            const inspRef = `EPV-${year}-${mm}-${String(refCounters[key]).padStart(4, '0')}`;
            const inspSoldToTrade = soldToTrade + rand(-20000, 20000);
            const inspLevyAmount = +(inspSoldToTrade * LEVY_RATE).toFixed(2);
            const inspId = inspectorIds.length > 0 ? inspectorIds[rand(0, inspectorIds.length - 1)] : 1;

            await pool.request()
              .input('crid', sql.Int, fac.Id)
              .input('pm', sql.Int, month)
              .input('py', sql.Int, year)
              .input('status', sql.NVarChar, 'Completed')
              .input('token', sql.NVarChar, inspToken)
              .input('ref', sql.NVarChar, inspRef)
              .input('bn', sql.NVarChar, fac.BusinessName || '')
              .input('ft', sql.NVarChar, fac.FacilityType || '')
              .input('email', sql.NVarChar, fac.Email || '')
              .input('owner', sql.NVarChar, 'Inspector (System Seed)')
              .input('os', sql.Decimal(18,2), openingStock)
              .input('ge', sql.Int, graded + rand(-2000, 2000))
              .input('uge', sql.Int, Math.max(0, ungraded + rand(-1000, 1000)))
              .input('tb', sql.Decimal(18,2), totalB)
              .input('stt', sql.Int, inspSoldToTrade)
              .input('levy', sql.Decimal(18,2), inspLevyAmount)
              .input('cs', sql.Decimal(18,2), Math.max(0, closingStock + rand(-5000, 5000)))
              .input('pst', sql.Int, Math.max(0, pulpSoldToTrade + rand(-5000, 5000)))
              .input('ca', sql.DateTime, new Date(completedAt))
              .input('cb', sql.NVarChar, 'Inspector (System Seed)')
              .input('etype', sql.NVarChar, 'Inspector')
              .input('inspId', sql.Int, inspId)
              .input('linked', sql.Int, clientEpvId)
              .input('fp', sql.NVarChar, fac.FacilityProvince || 'Gauteng')
              .query(`
                INSERT INTO EggProductionVerifications
                (ClientRecordId, PeriodMonth, PeriodYear, Status, Token, ReferenceNumber,
                 BusinessName, FacilityType, EmailAddress, AuthorizedPersonName,
                 OpeningStock, GradedEggsPurchased, UngradedEggsPurchased, TotalB,
                 SoldToTrade, LevyAmount, ClosingStock, PulpSoldToTrade,
                 CompletedAt, CompletedBy, EPVType, InspectorId, LinkedEPVId, FacilityProvince)
                VALUES
                (@crid, @pm, @py, @status, @token, @ref,
                 @bn, @ft, @email, @owner,
                 @os, @ge, @uge, @tb,
                 @stt, @levy, @cs, @pst,
                 @ca, @cb, @etype, @inspId, @linked, @fp)
              `);
            totalInspector++;
          }
        }
      }

      const pct = Math.min(100, Math.round(((i + batch.length) / facilities.length) * 100));
      process.stdout.write(`\r  ${pct}% (${i + batch.length}/${facilities.length})`);
    }
    console.log(' — done');
  }

  // ============================================================
  // PHASE 4: Update inspector references
  // ============================================================
  console.log('\n=== PHASE 4: Updating inspector references ===');

  if (inspectorIds.length > 0) {
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

    // Update VerifiedBy names
    for (let i = 0; i < INSPECTORS.length && i < inspectorIds.length; i++) {
      const name = `${INSPECTORS[i].first} ${INSPECTORS[i].last}`;
      await pool.request()
        .input('name', sql.NVarChar, name)
        .input('inspIdx', sql.Int, i)
        .input('total', sql.Int, INSPECTORS.length)
        .query(`UPDATE EggProductionVerifications
                SET VerifiedBy = @name
                WHERE IsVerified = 1 AND EPVType = 'Client'
                AND (Id % @total) = @inspIdx`);
    }
    console.log('Updated VerifiedBy names');
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  const formatR = n => 'R' + n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalUsers = await pool.request().query(
    'SELECT Role, COUNT(*) as cnt FROM Users GROUP BY Role ORDER BY Role'
  );
  console.log('\n========================================');
  console.log('FULL SEED SUMMARY');
  console.log('========================================');
  console.log(`Facilities imported:  ${facilities.length}`);
  console.log(`Months seeded:        Jan 2025 – Mar 2026 (15 months)`);
  console.log(`Completed EPVs:       ${totalClient}`);
  console.log(`Pending EPVs:         ${totalPending}`);
  console.log(`Inspector EPVs:       ${totalInspector}`);
  console.log(`Total EPVs:           ${totalClient + totalPending + totalInspector}`);
  console.log(`Completion rate:      ${((totalClient / (totalClient + totalPending)) * 100).toFixed(1)}%`);
  console.log(`Visit slots:          ${visitMap.size}`);
  console.log(`Total outstanding:    ${formatR(totalLevySum)}`);
  console.log(`Company Admins:       ${companyAdmins}`);
  console.log(`Basic Users:          ${basicUsers}`);
  console.log('----------------------------------------');
  console.log('Users by role:');
  totalUsers.recordset.forEach(r => console.log(`  ${r.Role}: ${r.cnt}`));
  console.log('  Default password:   Password@123');
  console.log('========================================');
  console.log('NO emails sent. NO reconciliation. NO POP. NO invoices.');
  console.log('Seed complete!');
  process.exit();
}

seed().catch(e => { console.error('Seed error:', e); process.exit(1); });
