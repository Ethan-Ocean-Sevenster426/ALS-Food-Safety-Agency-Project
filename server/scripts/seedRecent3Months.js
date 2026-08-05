/**
 * Recent-window seed for the Super Collections demo.
 *
 * For 15 facilities:
 *   - Ensures facility count = 15 (adds Sunnyside if missing).
 *   - Marks EVERY facility "On EPV Cycle".
 *   - Assigns an inspector (round-robin) via AssignedInspectorId.
 *   - Ensures each facility has an accepted Company Admin invitation
 *     (that's what drives the "Verified" badge in the master DB list).
 *   - Wipes every EPV outside the target window and reinserts May/Jun/Jul 2026.
 *   - The 45 EPVs are spread across a realistic mix of states:
 *       ~15% pending inspector, ~55% approved, ~30% rejected+revised;
 *       ~25% invoice not sent, ~25% sent unpaid, ~20% short paid, ~30% fully paid.
 *
 * Idempotent — re-running gives you a fresh distribution in the same window.
 */
const sql = require('mssql/msnodesqlv8');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connStr =
  'Driver={ODBC Driver 18 for SQL Server};Server=' + process.env.DB_SERVER +
  ';Database=' + process.env.DB_NAME + ';Trusted_Connection=Yes;TrustServerCertificate=Yes;';

const LEVY_RATE = 0.020;
const TARGET_FACILITIES = 15;
const TARGET_MONTHS = [
  { year: 2026, month: 5 },
  { year: 2026, month: 6 },
  { year: 2026, month: 7 },
];

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function jitter(base, pct) { return Math.max(0, Math.round(base * (1 + (Math.random() * 2 - 1) * pct))); }

function generateFigures(opening) {
  const graded = jitter(100000, 0.2);
  const ungraded = jitter(30000, 0.25);
  const marketReturns = jitter(500, 0.5);
  const machineLoss = jitter(300, 0.4);
  const sentToPulp = jitter(800, 0.4);
  const destroyed = jitter(150, 0.6);
  const exported = jitter(1000, 0.5);
  const soldToStaff = jitter(400, 0.4);
  const soldFarmStall = jitter(1500, 0.4);
  const transferred = jitter(500, 0.6);

  const totalB = graded + ungraded;
  const totalC = marketReturns + machineLoss + sentToPulp + destroyed + exported;
  const available = opening + totalB - totalC - soldToStaff - soldFarmStall - transferred;
  const soldToTrade = Math.max(0, Math.round(available * (0.5 + Math.random() * 0.2)));
  const totalD = soldToTrade + soldToStaff + soldFarmStall;
  const totalE = transferred;
  const levyAmount = Math.round(soldToTrade * LEVY_RATE * 100) / 100;
  const closingStock = opening + totalB - totalC - totalD - totalE;
  const actualClosingStock = Math.max(0, closingStock + rand(-200, 200));
  const lossGain = actualClosingStock - closingStock;

  const pulpOpen = jitter(500, 0.3);
  const pulpBought = jitter(150, 0.6);
  const pulpConv = jitter(200, 0.4);
  const pulpSoldTrade = jitter(400, 0.3);
  const pulpSoldProd = jitter(100, 0.5);
  const pulpLoss = jitter(50, 0.5);

  const powderOpen = jitter(200, 0.3);
  const powderBought = jitter(80, 0.6);
  const powderConv = jitter(120, 0.4);
  const powderSoldTrade = jitter(180, 0.4);
  const powderSoldProd = jitter(50, 0.5);
  const powderLoss = jitter(20, 0.5);

  return {
    opening, graded, ungraded, marketReturns,
    machineLoss, sentToPulp, destroyed, exported,
    soldToTrade, soldToStaff, soldFarmStall, transferred,
    totalB, totalC, totalD, totalE, levyAmount,
    closingStock, actualClosingStock, lossGain,
    pulpOpen, pulpBought, pulpConv, pulpSoldTrade, pulpSoldProd, pulpLoss,
    powderOpen, powderBought, powderConv, powderSoldTrade, powderSoldProd, powderLoss,
  };
}

async function insertEpv(tx, refSeq, opts) {
  const {
    clientId, year, month, status, epvType, linkedEpvId, inspectorId,
    isVerified, verifiedBy, completedBy,
    businessName, facilityType, facilityProvince, email, ownerName,
    figures,
  } = opts;

  const prefix = `EPV-${year}-${String(month).padStart(2, '0')}`;
  refSeq[prefix] = (refSeq[prefix] || 0) + 1;
  const referenceNumber = `${prefix}-${String(refSeq[prefix]).padStart(4, '0')}`;
  const token = crypto.randomBytes(32).toString('hex');
  const periodDate = new Date(Date.UTC(year, month - 1, 15));

  const r = new sql.Request(tx);
  r.input('crid', sql.Int, clientId);
  r.input('month', sql.Int, month);
  r.input('year', sql.Int, year);
  r.input('token', sql.NVarChar, token);
  r.input('refNum', sql.NVarChar, referenceNumber);
  r.input('status', sql.NVarChar, status);
  r.input('sentAt', sql.DateTime, periodDate);
  r.input('completedAt', sql.DateTime, periodDate);
  r.input('completedBy', sql.NVarChar, completedBy);
  r.input('epvType', sql.NVarChar, epvType);
  r.input('linkedEpvId', sql.Int, linkedEpvId);
  r.input('inspectorId', sql.Int, inspectorId);
  r.input('isVerified', sql.Bit, isVerified ? 1 : 0);
  r.input('verifiedBy', sql.NVarChar, isVerified ? verifiedBy : null);
  r.input('verifiedAt', sql.DateTime, isVerified ? periodDate : null);

  r.input('businessName', sql.NVarChar, businessName);
  r.input('facilityType', sql.NVarChar, facilityType || 'Producer');
  r.input('facilityProvince', sql.NVarChar, facilityProvince || 'Gauteng');
  r.input('email', sql.NVarChar, email || '');
  r.input('ownerName', sql.NVarChar, ownerName || '');

  const f = figures;
  r.input('openingStock', sql.Decimal(18, 2), f.opening);
  r.input('graded', sql.Decimal(18, 2), f.graded);
  r.input('ungraded', sql.Decimal(18, 2), f.ungraded);
  r.input('marketReturns', sql.Decimal(18, 2), f.marketReturns);
  r.input('machineLoss', sql.Decimal(18, 2), f.machineLoss);
  r.input('sentToPulp', sql.Decimal(18, 2), f.sentToPulp);
  r.input('destroyed', sql.Decimal(18, 2), f.destroyed);
  r.input('exported', sql.Decimal(18, 2), f.exported);
  r.input('soldToTrade', sql.Decimal(18, 2), f.soldToTrade);
  r.input('soldToStaff', sql.Decimal(18, 2), f.soldToStaff);
  r.input('soldFarmStall', sql.Decimal(18, 2), f.soldFarmStall);
  r.input('transferred', sql.Decimal(18, 2), f.transferred);
  r.input('totalB', sql.Decimal(18, 2), f.totalB);
  r.input('totalC', sql.Decimal(18, 2), f.totalC);
  r.input('totalD', sql.Decimal(18, 2), f.totalD);
  r.input('totalE', sql.Decimal(18, 2), f.totalE);
  r.input('levyAmount', sql.Decimal(18, 4), f.levyAmount);
  r.input('closingStock', sql.Decimal(18, 2), f.closingStock);
  r.input('actualClosingStock', sql.Decimal(18, 2), f.actualClosingStock);
  r.input('lossGain', sql.Decimal(18, 2), f.lossGain);
  r.input('pulpOpen', sql.Decimal(18, 2), f.pulpOpen);
  r.input('pulpBought', sql.Decimal(18, 2), f.pulpBought);
  r.input('pulpConv', sql.Decimal(18, 2), f.pulpConv);
  r.input('pulpSoldTrade', sql.Decimal(18, 2), f.pulpSoldTrade);
  r.input('pulpSoldProd', sql.Decimal(18, 2), f.pulpSoldProd);
  r.input('pulpLoss', sql.Decimal(18, 2), f.pulpLoss);
  r.input('powderOpen', sql.Decimal(18, 2), f.powderOpen);
  r.input('powderBought', sql.Decimal(18, 2), f.powderBought);
  r.input('powderConv', sql.Decimal(18, 2), f.powderConv);
  r.input('powderSoldTrade', sql.Decimal(18, 2), f.powderSoldTrade);
  r.input('powderSoldProd', sql.Decimal(18, 2), f.powderSoldProd);
  r.input('powderLoss', sql.Decimal(18, 2), f.powderLoss);

  const result = await r.query(`
    INSERT INTO EggProductionVerifications (
      ClientRecordId, PeriodMonth, PeriodYear, Token, ReferenceNumber, Status,
      SentAt, CompletedAt, CompletedBy,
      BusinessName, FacilityType, FacilityProvince, EmailAddress, AuthorizedPersonName,
      OpeningStock, GradedEggsPurchased, UngradedEggsPurchased,
      MarketReturns, MachineLoss, SentToPulp, Destroyed, Exported,
      SoldToTrade, SoldToStaff, SoldThroughFarmStall,
      TransferredToOtherProducers,
      TotalB, TotalC, TotalD, TotalE, LevyAmount,
      ClosingStock, ActualClosingStock, LossGain,
      PulpOpeningStock, PulpPurchased, PulpConverted,
      PulpSoldToTrade, PulpSoldToProducers, PulpConversionLoss,
      PowderOpeningStock, PowderPurchased, PowderConverted,
      PowderSoldToTrade, PowderSoldToProducers, PowderConversionLoss,
      EPVType, InspectorId, LinkedEPVId,
      IsVerified, VerifiedBy, VerifiedAt
    )
    OUTPUT INSERTED.Id
    VALUES (
      @crid, @month, @year, @token, @refNum, @status,
      @sentAt, @completedAt, @completedBy,
      @businessName, @facilityType, @facilityProvince, @email, @ownerName,
      @openingStock, @graded, @ungraded,
      @marketReturns, @machineLoss, @sentToPulp, @destroyed, @exported,
      @soldToTrade, @soldToStaff, @soldFarmStall,
      @transferred,
      @totalB, @totalC, @totalD, @totalE, @levyAmount,
      @closingStock, @actualClosingStock, @lossGain,
      @pulpOpen, @pulpBought, @pulpConv,
      @pulpSoldTrade, @pulpSoldProd, @pulpLoss,
      @powderOpen, @powderBought, @powderConv,
      @powderSoldTrade, @powderSoldProd, @powderLoss,
      @epvType, @inspectorId, @linkedEpvId,
      @isVerified, @verifiedBy, @verifiedAt
    )
  `);
  return result.recordset[0].Id;
}

async function applySuperState(tx, epvId, invoiceState, invoiceAmount, year, month) {
  const sentByLabel = 'super@collect.co.za';
  const superRecByLabel = 'Super Collections';
  if (invoiceState === 'notSent') return;
  const sentAt = new Date(Date.UTC(year, month - 1, 20));
  if (invoiceState === 'sentUnpaid') {
    await new sql.Request(tx)
      .input('id', sql.Int, epvId)
      .input('by', sql.NVarChar, sentByLabel)
      .input('at', sql.DateTime, sentAt)
      .query(`UPDATE EggProductionVerifications
              SET SuperInvoiceSent = 1, SuperInvoiceSentBy = @by, SuperInvoiceSentAt = @at
              WHERE Id = @id`);
    return;
  }
  const paidRatio = invoiceState === 'sentShort' ? 0.5 + Math.random() * 0.3 : 1.0;
  const paid = Math.round(invoiceAmount * paidRatio * 100) / 100;
  const recAt = new Date(Date.UTC(year, month - 1, 25));
  await new sql.Request(tx)
    .input('id', sql.Int, epvId)
    .input('by', sql.NVarChar, sentByLabel)
    .input('at', sql.DateTime, sentAt)
    .input('amt', sql.Decimal(18, 2), paid)
    .input('recBy', sql.NVarChar, superRecByLabel)
    .input('recAt', sql.DateTime, recAt)
    .query(`UPDATE EggProductionVerifications
            SET SuperInvoiceSent = 1, SuperInvoiceSentBy = @by, SuperInvoiceSentAt = @at,
                IsReconciled = 1, ReconciledAmount = @amt,
                ReconciledBy = @recBy, ReconciledAt = @recAt,
                SuperReconciledBy = @recBy, SuperReconciledAt = @recAt
            WHERE Id = @id`);
}

async function ensureFifteenthFacility(pool) {
  const count = (await pool.request().query('SELECT COUNT(*) AS cnt FROM ConsolidatedMasterAbattoirDatabase')).recordset[0].cnt;
  if (count >= TARGET_FACILITIES) return;
  const req = pool.request();
  req.input('name',  sql.NVarChar, 'Sunnyside Egg Co (Pty) Ltd');
  req.input('acc',   sql.NVarChar, 'DEMO-001');
  req.input('email', sql.NVarChar, 'info@sunnyside.co.za');
  req.input('town',  sql.NVarChar, 'Pretoria');
  req.input('ft',    sql.NVarChar, 'Producer');
  req.input('prov',  sql.NVarChar, 'Gauteng');
  await req.query(`
    INSERT INTO ConsolidatedMasterAbattoirDatabase
      (BusinessName, AccountCode, Email, Town, FacilityType, FacilityProvince,
       AbattoirOwnerName, AbattoirOwnerEmail)
    VALUES (@name, @acc, @email, @town, @ft, @prov,
       'Pieter van der Merwe', 'pieter@sunnyside.co.za')
  `);
  console.log('  added Sunnyside Egg Co to reach 15 facilities');
}

async function markOnCycleAndAssignInspectors(pool, facilities, inspectors) {
  for (let i = 0; i < facilities.length; i++) {
    const f = facilities[i];
    const insp = inspectors[i % inspectors.length];
    await pool.request()
      .input('id', sql.Int, f.Id)
      .input('insp', sql.Int, insp.Id)
      .query(`UPDATE ConsolidatedMasterAbattoirDatabase
              SET EPVCycleStatus = 'On EPV Cycle',
                  AssignedInspectorId = @insp
              WHERE Id = @id`);
  }
  console.log('  all ' + facilities.length + ' facilities on EPV Cycle + inspector assigned');
}

async function ensureAcceptedInvitations(pool, facilities) {
  for (const f of facilities) {
    const existing = await pool.request()
      .input('cid', sql.Int, f.Id)
      .query(`SELECT TOP 1 Id FROM Invitations
              WHERE ClientRecordId = @cid AND Role = 'Company Admin' AND Status = 'Accepted'`);
    if (existing.recordset.length > 0) continue;
    const email = 'admin.' + f.Id + '@' + (f.Email && f.Email.split('@')[1] ? f.Email.split('@')[1] : 'demo.co.za');
    const token = crypto.randomBytes(32).toString('hex');
    await pool.request()
      .input('cid', sql.Int, f.Id)
      .input('email', sql.NVarChar, email)
      .input('token', sql.NVarChar, token)
      .input('invBy', sql.NVarChar, 'Seed Script')
      .query(`INSERT INTO Invitations
                (ClientRecordId, Email, Role, Token, Status, AcceptedAt, InvitedBy)
              VALUES (@cid, @email, 'Company Admin', @token, 'Accepted', GETDATE(), @invBy)`);
  }
  console.log('  onboarding invitations ensured for all facilities');
}

async function wipeAllEpvsOutsideWindow(pool) {
  // Keep only May/Jun/Jul 2026; delete everything else (children first).
  const monthList = TARGET_MONTHS.map(m => m.month).join(',');
  const year = TARGET_MONTHS[0].year;
  await pool.request().query(`
    DELETE FROM EPVAuditLog WHERE VerificationId IN (
      SELECT Id FROM EggProductionVerifications
      WHERE NOT (PeriodYear = ${year} AND PeriodMonth IN (${monthList}))
    )
  `);
  await pool.request().query(`
    DELETE FROM EPVInvoices WHERE VerificationId IN (
      SELECT Id FROM EggProductionVerifications
      WHERE NOT (PeriodYear = ${year} AND PeriodMonth IN (${monthList}))
    )
  `);
  await pool.request().query(`
    DELETE FROM EPVAttachments WHERE VerificationId IN (
      SELECT Id FROM EggProductionVerifications
      WHERE NOT (PeriodYear = ${year} AND PeriodMonth IN (${monthList}))
    )
  `);
  await pool.request().query(`
    DELETE FROM EggProductionVerifications
    WHERE NOT (PeriodYear = ${year} AND PeriodMonth IN (${monthList}))
  `);
  // Also wipe target window for a clean reseed
  await pool.request().query(`
    DELETE FROM EPVAuditLog WHERE VerificationId IN (
      SELECT Id FROM EggProductionVerifications
      WHERE PeriodYear = ${year} AND PeriodMonth IN (${monthList})
    )
  `);
  await pool.request().query(`
    DELETE FROM EPVInvoices WHERE VerificationId IN (
      SELECT Id FROM EggProductionVerifications
      WHERE PeriodYear = ${year} AND PeriodMonth IN (${monthList})
    )
  `);
  await pool.request().query(`
    DELETE FROM EPVAttachments WHERE VerificationId IN (
      SELECT Id FROM EggProductionVerifications
      WHERE PeriodYear = ${year} AND PeriodMonth IN (${monthList})
    )
  `);
  await pool.request().query(`
    DELETE FROM EggProductionVerifications
    WHERE PeriodYear = ${year} AND PeriodMonth IN (${monthList})
  `);
  console.log('  wiped all EPVs — clean slate for May/Jun/Jul 2026 reseed');
}

(async () => {
  const pool = await sql.connect({ connectionString: connStr });

  await ensureFifteenthFacility(pool);

  const facilities = (await pool.request().query(`
    SELECT TOP ${TARGET_FACILITIES} Id, BusinessName, FacilityType, FacilityProvince, Email, AbattoirOwnerName
    FROM ConsolidatedMasterAbattoirDatabase ORDER BY Id
  `)).recordset;
  console.log('Preparing ' + facilities.length + ' facilities');

  const inspectors = (await pool.request().query(
    "SELECT Id, FirstName, LastName FROM Users WHERE Role = 'Inspector' ORDER BY Id"
  )).recordset;
  if (inspectors.length === 0) throw new Error('No inspectors found');

  await markOnCycleAndAssignInspectors(pool, facilities, inspectors);
  await ensureAcceptedInvitations(pool, facilities);
  await wipeAllEpvsOutsideWindow(pool);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const refSeq = {};
    const stats = {
      pending: 0,
      'approved+notSent': 0, 'approved+sent+unpaid': 0,
      'approved+sent+short': 0, 'approved+sent+full': 0,
      'rejected+notSent': 0, 'rejected+sent+unpaid': 0,
      'rejected+sent+short': 0, 'rejected+sent+full': 0,
    };

    for (const f of facilities) {
      let openingStock = jitter(20000, 0.3);
      for (const { year, month } of TARGET_MONTHS) {
        const facFigures = generateFigures(openingStock);
        const inspector = inspectors[rand(0, inspectors.length - 1)];
        const inspectorName = `${inspector.FirstName} ${inspector.LastName}`;

        const stateRoll = Math.random();
        const approvalState = stateRoll < 0.15 ? 'pending'
                            : stateRoll < 0.70 ? 'approved'
                            : 'rejected';

        const invRoll = Math.random();
        const invoiceState = invRoll < 0.25 ? 'notSent'
                           : invRoll < 0.50 ? 'sentUnpaid'
                           : invRoll < 0.70 ? 'sentShort'
                           : 'sentFull';

        const facEpvId = await insertEpv(tx, refSeq, {
          clientId: f.Id, year, month, status: 'Completed', epvType: 'Client',
          linkedEpvId: null, inspectorId: null,
          isVerified: approvalState === 'approved',
          verifiedBy: approvalState === 'approved' ? inspectorName : null,
          completedBy: f.AbattoirOwnerName || 'Facility User',
          businessName: f.BusinessName, facilityType: f.FacilityType,
          facilityProvince: f.FacilityProvince, email: f.Email, ownerName: f.AbattoirOwnerName,
          figures: facFigures,
        });

        let invoiceAmount = 0;
        if (approvalState === 'approved') {
          invoiceAmount = facFigures.levyAmount
            + facFigures.pulpSoldTrade * 1.7 * LEVY_RATE
            + facFigures.powderSoldTrade * LEVY_RATE;
          await applySuperState(tx, facEpvId, invoiceState, invoiceAmount, year, month);
          const key = 'approved+' + (invoiceState === 'notSent' ? 'notSent'
            : invoiceState === 'sentUnpaid' ? 'sent+unpaid'
            : invoiceState === 'sentShort' ? 'sent+short' : 'sent+full');
          stats[key] = (stats[key] || 0) + 1;
        } else if (approvalState === 'rejected') {
          const inspFigures = { ...facFigures };
          inspFigures.soldToTrade = Math.max(0, facFigures.soldToTrade + rand(-800, -100));
          inspFigures.levyAmount = Math.round(inspFigures.soldToTrade * LEVY_RATE * 100) / 100;
          inspFigures.totalD = inspFigures.soldToTrade + facFigures.soldToStaff + facFigures.soldFarmStall;

          await insertEpv(tx, refSeq, {
            clientId: f.Id, year, month, status: 'Completed', epvType: 'Inspector',
            linkedEpvId: facEpvId, inspectorId: inspector.Id,
            isVerified: false, verifiedBy: null,
            completedBy: inspectorName,
            businessName: f.BusinessName, facilityType: f.FacilityType,
            facilityProvince: f.FacilityProvince, email: f.Email, ownerName: f.AbattoirOwnerName,
            figures: inspFigures,
          });
          invoiceAmount = inspFigures.levyAmount
            + inspFigures.pulpSoldTrade * 1.7 * LEVY_RATE
            + inspFigures.powderSoldTrade * LEVY_RATE;
          await applySuperState(tx, facEpvId, invoiceState, invoiceAmount, year, month);
          const key = 'rejected+' + (invoiceState === 'notSent' ? 'notSent'
            : invoiceState === 'sentUnpaid' ? 'sent+unpaid'
            : invoiceState === 'sentShort' ? 'sent+short' : 'sent+full');
          stats[key] = (stats[key] || 0) + 1;
        } else {
          stats.pending++;
        }

        openingStock = Math.max(0, facFigures.actualClosingStock);
      }
    }

    await tx.commit();

    console.log('\nSeeded distribution:');
    Object.entries(stats).forEach(([k, v]) => console.log('  ' + k + ': ' + v));
    console.log('\nAll facilities marked "On EPV Cycle", inspector assigned, and onboarded.');
    console.log('EPVs cover only May, June, and July 2026 — nothing earlier or later remains.');
    process.exit(0);
  } catch (err) {
    console.error('ERROR — rolling back:', err.message);
    await tx.rollback();
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(1); });
