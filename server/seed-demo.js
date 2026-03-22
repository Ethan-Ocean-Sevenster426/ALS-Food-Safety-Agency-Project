/**
 * Demo seed script — populates EPVs for Jan–Mar 2026 for ALL facilities.
 * NO emails are sent. Run once: node seed-demo.js
 */
require('dotenv').config();
const crypto = require('crypto');
const sql = require('mssql/msnodesqlv8');

const config = {
  connectionString:
    'Driver={ODBC Driver 18 for SQL Server};Server=' +
    process.env.DB_SERVER +
    ';Database=' +
    process.env.DB_NAME +
    ';Trusted_Connection=yes;TrustServerCertificate=yes;',
};

const LEVY_RATE = 0.018;

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randDec(min, max) {
  return +(Math.random() * (max - min) + min).toFixed(2);
}

async function seed() {
  const pool = await sql.connect(config);

  // 1. Get all facilities
  const { recordset: facilities } = await pool.request().query(
    'SELECT Id, BusinessName, FacilityType, Email, AbattoirOwnerName, FacilityProvince FROM ConsolidatedMasterAbattoirDatabase ORDER BY Id'
  );
  console.log(`Found ${facilities.length} facilities`);

  // 2. Delete existing data (respect FK order)
  try { await pool.request().query('DELETE FROM EPVInvoices'); } catch(e) {}
  try { await pool.request().query('DELETE FROM EPVAuditLog'); } catch(e) {}
  try { await pool.request().query('DELETE FROM EmailSendLog'); } catch(e) {}
  try { await pool.request().query('DELETE FROM ClientAuditLog'); } catch(e) {}
  await pool.request().query('DELETE FROM EggProductionVerifications');
  console.log('Cleared existing data');

  // 3. Months config
  // Jan = 95% paid, Feb = 80% paid, Mar = 65% paid
  const months = [
    { month: 1, year: 2026, paidPct: 0.95 },
    { month: 2, year: 2026, paidPct: 0.80 },
    { month: 3, year: 2026, paidPct: 0.65 },
  ];

  let refCounters = { '01': 0, '02': 0, '03': 0 };
  let totalInserted = 0;
  let totalInspector = 0;

  for (const { month, year, paidPct } of months) {
    const mm = String(month).padStart(2, '0');
    console.log(`\nSeeding ${year}-${mm} (${paidPct * 100}% paid)...`);

    // Process in batches of 50
    for (let i = 0; i < facilities.length; i += 50) {
      const batch = facilities.slice(i, i + 50);

      for (const fac of batch) {
        refCounters[mm]++;
        const refNum = `EPV-${year}-${mm}-${String(refCounters[mm]).padStart(4, '0')}`;
        const token = crypto.randomBytes(32).toString('hex');

        // Random production data
        const openingStock = randDec(100, 50000);
        const graded = rand(0, 30000);
        const ungraded = rand(0, 10000);
        const totalB = graded + ungraded + openingStock;
        const marketReturns = rand(0, 500);
        const machineLoss = rand(0, 200);
        const sentToPulp = rand(0, 1000);
        const destroyed = rand(0, 100);
        const totalC = marketReturns + machineLoss + sentToPulp + destroyed;
        const soldToTrade = rand(500, 40000);
        const exported = rand(0, 2000);
        const soldToStaff = rand(0, 500);
        const soldFarmStall = rand(0, 1000);
        const totalD = soldToTrade + exported + soldToStaff + soldFarmStall;
        const levyAmount = +(soldToTrade * LEVY_RATE).toFixed(2);
        const transferred = rand(0, 500);
        const closingStock = +(totalB - totalC - totalD - transferred).toFixed(2);
        const pulpSoldToTrade = rand(0, 500);

        // Determine scenario
        const roll = Math.random();
        let isRejected = false;       // ~15% rejected (inspector completed)
        let isInspOutstanding = false; // ~5% inspector pending
        let isPaid = false;

        if (roll < 0.05) {
          isInspOutstanding = true; // 5% outstanding for inspector
        } else if (roll < 0.20) {
          isRejected = true; // 15% rejected, inspector completed
        }

        isPaid = Math.random() < paidPct;

        // Completed date — random day in the month
        const completedDay = rand(1, 28);
        const completedAt = `${year}-${mm}-${String(completedDay).padStart(2, '0')}T${String(rand(8,17)).padStart(2,'0')}:${String(rand(0,59)).padStart(2,'0')}:00`;

        // Calculate amounts for inspector scenario
        let finalLevyAmount = levyAmount;
        let finalPulpLevy = +(pulpSoldToTrade * 1.7 * LEVY_RATE).toFixed(2);
        let totalOutstanding = +(finalLevyAmount + finalPulpLevy).toFixed(2);

        // Reconciled amount — if paid
        let reconciledAmount = isPaid ? totalOutstanding : (Math.random() < 0.3 ? +(totalOutstanding * randDec(0.1, 0.5)).toFixed(2) : null);
        let isReconciled = isPaid ? 1 : 0;
        let reconciledBy = isPaid ? 'Anthony Penzes (anthony@epvs.com)' : null;
        let reconciledAt = isPaid ? `${year}-${mm}-${String(Math.min(28, completedDay + rand(2,10))).padStart(2,'0')}T14:00:00` : null;

        // Verified status — most are verified
        let isVerified = (isRejected || isInspOutstanding) ? 1 : (Math.random() < 0.9 ? 1 : 0);
        let verifiedBy = isVerified ? 'Anthony Penzes (anthony@epvs.com)' : null;
        let verifiedAt = isVerified ? completedAt : null;

        // POP upload — if paid
        let popPath = isPaid ? `pop_${refNum.replace(/[^a-zA-Z0-9]/g,'_')}.pdf` : null;
        let popUploadedAt = isPaid ? reconciledAt : null;
        let popUploadedBy = isPaid ? 'Test User' : null;

        // Inspector comment for rejected
        let inspComment = null;
        if (isRejected) inspComment = 'Amounts corrected by inspector after verification.';
        if (isInspOutstanding) inspComment = 'Pending inspector review — amounts under investigation.';

        // Insert client EPV
        await pool.request()
          .input('crid', sql.Int, fac.Id)
          .input('pm', sql.Int, month)
          .input('py', sql.Int, year)
          .input('status', sql.NVarChar, 'Completed')
          .input('token', sql.NVarChar, token)
          .input('ref', sql.NVarChar, refNum)
          .input('bn', sql.NVarChar, fac.BusinessName || '')
          .input('ft', sql.NVarChar, fac.FacilityType || '')
          .input('email', sql.NVarChar, 'test@test.com')
          .input('owner', sql.NVarChar, fac.AbattoirOwnerName || 'Test Owner')
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
          .input('levy', sql.Decimal(18,2), finalLevyAmount)
          .input('trans', sql.Int, transferred)
          .input('cs', sql.Decimal(18,2), Math.max(0, closingStock))
          .input('pst', sql.Int, pulpSoldToTrade)
          .input('ca', sql.DateTime, new Date(completedAt))
          .input('cb', sql.NVarChar, 'Test User')
          .input('iv', sql.Bit, isVerified)
          .input('vb', sql.NVarChar, verifiedBy)
          .input('va', sql.DateTime, verifiedAt ? new Date(verifiedAt) : null)
          .input('ic', sql.NVarChar, inspComment)
          .input('ra', sql.Decimal(18,2), reconciledAmount)
          .input('ir', sql.Bit, isReconciled)
          .input('rb', sql.NVarChar, reconciledBy)
          .input('rat', sql.DateTime, reconciledAt ? new Date(reconciledAt) : null)
          .input('pp', sql.NVarChar, popPath)
          .input('pua', sql.DateTime, popUploadedAt ? new Date(popUploadedAt) : null)
          .input('pub', sql.NVarChar, popUploadedBy)
          .input('etype', sql.NVarChar, 'Client')
          .input('fp', sql.NVarChar, fac.FacilityProvince || 'Gauteng')
          .query(`
            INSERT INTO EggProductionVerifications
            (ClientRecordId, PeriodMonth, PeriodYear, Status, Token, ReferenceNumber,
             BusinessName, FacilityType, EmailAddress, AuthorizedPersonName,
             OpeningStock, GradedEggsPurchased, UngradedEggsPurchased, TotalB,
             MarketReturns, MachineLoss, SentToPulp, Destroyed, TotalC,
             SoldToTrade, Exported, SoldToStaff, SoldThroughFarmStall, TotalD,
             LevyAmount, TransferredToOtherProducers, ClosingStock, PulpSoldToTrade,
             CompletedAt, CompletedBy, IsVerified, VerifiedBy, VerifiedAt,
             InspectorComment, ReconciledAmount, IsReconciled, ReconciledBy, ReconciledAt,
             POPFilePath, POPUploadedAt, POPUploadedBy, EPVType, FacilityProvince)
            VALUES
            (@crid, @pm, @py, @status, @token, @ref,
             @bn, @ft, @email, @owner,
             @os, @ge, @uge, @tb,
             @mr, @ml, @stp, @dest, @tc,
             @stt, @exp, @sts, @stf, @td,
             @levy, @trans, @cs, @pst,
             @ca, @cb, @iv, @vb, @va,
             @ic, @ra, @ir, @rb, @rat,
             @pp, @pua, @pub, @etype, @fp)
          `);
        totalInserted++;

        // Get the inserted client EPV Id
        if (isRejected || isInspOutstanding) {
          const lastId = await pool.request()
            .input('crid2', sql.Int, fac.Id)
            .input('pm2', sql.Int, month)
            .input('py2', sql.Int, year)
            .input('ref2', sql.NVarChar, refNum)
            .query("SELECT Id FROM EggProductionVerifications WHERE ClientRecordId=@crid2 AND PeriodMonth=@pm2 AND PeriodYear=@py2 AND ReferenceNumber=@ref2 AND EPVType='Client'");

          const clientEpvId = lastId.recordset[0]?.Id;
          if (clientEpvId) {
            const inspToken = crypto.randomBytes(32).toString('hex');
            refCounters[mm]++;
            const inspRef = `EPV-${year}-${mm}-${String(refCounters[mm]).padStart(4, '0')}`;

            // Inspector EPV — corrected amounts (slightly different)
            const inspLevyAmount = +(finalLevyAmount * randDec(0.8, 1.2)).toFixed(2);
            const inspPulpLevy = +(finalPulpLevy * randDec(0.8, 1.2)).toFixed(2);
            const inspStatus = isInspOutstanding ? 'Pending' : 'Completed';
            const inspCompletedAt = isInspOutstanding ? null : new Date(completedAt);

            await pool.request()
              .input('crid', sql.Int, fac.Id)
              .input('pm', sql.Int, month)
              .input('py', sql.Int, year)
              .input('status', sql.NVarChar, inspStatus)
              .input('token', sql.NVarChar, inspToken)
              .input('ref', sql.NVarChar, inspRef)
              .input('bn', sql.NVarChar, fac.BusinessName || '')
              .input('ft', sql.NVarChar, fac.FacilityType || '')
              .input('email', sql.NVarChar, 'test@test.com')
              .input('owner', sql.NVarChar, 'Inspector A. Penzes')
              .input('os', sql.Decimal(18,2), openingStock)
              .input('ge', sql.Int, graded + rand(-500, 500))
              .input('uge', sql.Int, ungraded + rand(-200, 200))
              .input('tb', sql.Decimal(18,2), totalB)
              .input('stt', sql.Int, soldToTrade + rand(-1000, 1000))
              .input('levy', sql.Decimal(18,2), inspLevyAmount)
              .input('cs', sql.Decimal(18,2), Math.max(0, closingStock + rand(-500, 500)))
              .input('pst', sql.Int, Math.max(0, pulpSoldToTrade + rand(-100, 100)))
              .input('ca', sql.DateTime, inspCompletedAt)
              .input('cb', sql.NVarChar, inspCompletedAt ? 'Inspector Penzes' : null)
              .input('etype', sql.NVarChar, 'Inspector')
              .input('inspId', sql.Int, 1)
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

      // Progress
      const pct = Math.min(100, Math.round(((i + batch.length) / facilities.length) * 100));
      process.stdout.write(`\r  ${pct}% (${i + batch.length}/${facilities.length})`);
    }
    console.log(' — done');
  }

  console.log(`\nTotal client EPVs inserted: ${totalInserted}`);
  console.log(`Total inspector EPVs inserted: ${totalInspector}`);
  console.log('Seed complete!');
  process.exit();
}

seed().catch(e => { console.error('Seed error:', e); process.exit(1); });
