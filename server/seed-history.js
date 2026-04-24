/**
 * Historical EPV seed script.
 *
 * For every facility in ConsolidatedMasterAbattoirDatabase:
 *   - 2025 Jan..Dec: facility EPV (Completed, Verified) + matching Inspector EPV
 *   - 2026 Jan..Mar: facility EPV (Completed, NOT verified), no inspector EPV
 *
 * Idempotent: re-running deletes any EPVs that fall inside these windows
 * for the affected facilities, then reinserts. EmailSendLog / audit are not
 * touched.
 *
 * Run:  node seed-history.js
 */
require('dotenv').config();
const crypto = require('crypto');
const sql = require('mssql/msnodesqlv8');

const LEVY_RATE = 0.020; // matches EPV form display

const connStr =
  'Driver={ODBC Driver 18 for SQL Server};Server=' + process.env.DB_SERVER +
  ';Database=' + process.env.DB_NAME + ';Trusted_Connection=Yes;TrustServerCertificate=Yes;';

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function jitter(base, pct) { return Math.round(base * (1 + (Math.random() * 2 - 1) * pct)); }

// Plausible monthly figures; values are per-month for one facility.
function generateMonthlyFigures(openingStock) {
  const graded = jitter(100000, 0.2);
  const ungraded = jitter(30000, 0.25);
  const marketReturns = jitter(500, 0.5);
  const machineLoss = jitter(300, 0.4);
  const sentToPulp = jitter(800, 0.4);
  const destroyed = jitter(150, 0.6);
  const exported = jitter(1000, 0.5);
  const soldToStaff = jitter(400, 0.4);
  const soldThroughFarmStall = jitter(1500, 0.4);
  const transferred = jitter(500, 0.6);

  // Purchases
  const totalB = graded + ungraded;
  // Deductions
  const totalC = marketReturns + machineLoss + sentToPulp + destroyed + exported;
  // Leave ~30-50% available for sales-to-trade (main levy driver)
  const availableForSales = openingStock + totalB - totalC - soldToStaff - soldThroughFarmStall - transferred;
  const soldToTrade = Math.max(0, Math.round(availableForSales * (0.5 + Math.random() * 0.2)));
  const totalD = soldToTrade + soldToStaff + soldThroughFarmStall;
  const totalE = transferred;
  const levyAmount = Math.round(soldToTrade * LEVY_RATE * 100) / 100;
  const closingStock = openingStock + totalB - totalC - totalD - totalE;
  const actualClosingStock = Math.max(0, closingStock + jitter(0, 0) + rand(-200, 200));
  const lossGain = actualClosingStock - closingStock;

  const pulpOpening = jitter(500, 0.3);
  const pulpPurchased = jitter(150, 0.6);
  const pulpConverted = jitter(200, 0.4);
  const pulpSoldToTrade = jitter(400, 0.3);
  const pulpSoldToProducers = jitter(100, 0.5);
  const pulpConversionLoss = jitter(50, 0.5);
  const pulpLevyAmount = Math.round(pulpSoldToTrade * 1.7 * LEVY_RATE * 100) / 100;

  return {
    openingStock,
    graded, ungraded, marketReturns,
    machineLoss, sentToPulp, destroyed, exported,
    soldToTrade, soldToStaff, soldThroughFarmStall,
    transferred,
    totalB, totalC, totalD, totalE,
    levyAmount,
    closingStock, actualClosingStock, lossGain,
    pulpOpening, pulpPurchased, pulpConverted,
    pulpSoldToTrade, pulpSoldToProducers, pulpConversionLoss,
    pulpLevyAmount,
  };
}

async function insertEpv(tx, refCounter, {
  clientId, year, month, status, isVerified, verifiedBy,
  businessName, facilityType, facilityProvince, email, ownerName,
  epvType, linkedEpvId, inspectorId, figures,
  completedBy,
}) {
  const token = crypto.randomBytes(32).toString('hex');
  const prefix = `EPV-${year}-${String(month).padStart(2, '0')}`;
  refCounter[prefix] = (refCounter[prefix] || 0) + 1;
  const referenceNumber = `${prefix}-${String(refCounter[prefix]).padStart(4, '0')}`;
  const periodDate = new Date(Date.UTC(year, month - 1, 15));

  const r = new sql.Request(tx);
  r.input('crid', sql.Int, clientId);
  r.input('month', sql.Int, month);
  r.input('year', sql.Int, year);
  r.input('token', sql.NVarChar, token);
  r.input('refNum', sql.NVarChar, referenceNumber);
  r.input('status', sql.NVarChar, status);
  r.input('businessName', sql.NVarChar, businessName);
  r.input('facilityType', sql.NVarChar, facilityType);
  r.input('facilityProvince', sql.NVarChar, facilityProvince);
  r.input('email', sql.NVarChar, email);
  r.input('ownerName', sql.NVarChar, ownerName);
  r.input('completedBy', sql.NVarChar, completedBy);
  r.input('completedAt', sql.DateTime, periodDate);
  r.input('sentAt', sql.DateTime, periodDate);
  r.input('epvType', sql.NVarChar, epvType);
  r.input('linkedEpvId', sql.Int, linkedEpvId);
  r.input('inspectorId', sql.Int, inspectorId);
  r.input('isVerified', sql.Bit, isVerified ? 1 : 0);
  r.input('verifiedBy', sql.NVarChar, isVerified ? verifiedBy : null);
  r.input('verifiedAt', sql.DateTime, isVerified ? periodDate : null);

  r.input('openingStock', sql.Decimal(18, 2), figures.openingStock);
  r.input('graded', sql.Decimal(18, 2), figures.graded);
  r.input('ungraded', sql.Decimal(18, 2), figures.ungraded);
  r.input('marketReturns', sql.Decimal(18, 2), figures.marketReturns);
  r.input('machineLoss', sql.Decimal(18, 2), figures.machineLoss);
  r.input('sentToPulp', sql.Decimal(18, 2), figures.sentToPulp);
  r.input('destroyed', sql.Decimal(18, 2), figures.destroyed);
  r.input('exported', sql.Decimal(18, 2), figures.exported);
  r.input('soldToTrade', sql.Decimal(18, 2), figures.soldToTrade);
  r.input('soldToStaff', sql.Decimal(18, 2), figures.soldToStaff);
  r.input('soldFarmStall', sql.Decimal(18, 2), figures.soldThroughFarmStall);
  r.input('transferred', sql.Decimal(18, 2), figures.transferred);
  r.input('totalB', sql.Decimal(18, 2), figures.totalB);
  r.input('totalC', sql.Decimal(18, 2), figures.totalC);
  r.input('totalD', sql.Decimal(18, 2), figures.totalD);
  r.input('totalE', sql.Decimal(18, 2), figures.totalE);
  r.input('levyAmount', sql.Decimal(18, 4), figures.levyAmount);
  r.input('closingStock', sql.Decimal(18, 2), figures.closingStock);
  r.input('actualClosingStock', sql.Decimal(18, 2), figures.actualClosingStock);
  r.input('lossGain', sql.Decimal(18, 2), figures.lossGain);

  r.input('pulpOpening', sql.Int, figures.pulpOpening);
  r.input('pulpPurchased', sql.Int, figures.pulpPurchased);
  r.input('pulpConverted', sql.Int, figures.pulpConverted);
  r.input('pulpSoldToTrade', sql.Int, figures.pulpSoldToTrade);
  r.input('pulpSoldToProducers', sql.Int, figures.pulpSoldToProducers);
  r.input('pulpConversionLoss', sql.Int, figures.pulpConversionLoss);

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
      @pulpOpening, @pulpPurchased, @pulpConverted,
      @pulpSoldToTrade, @pulpSoldToProducers, @pulpConversionLoss,
      @epvType, @inspectorId, @linkedEpvId,
      @isVerified, @verifiedBy, @verifiedAt
    )
  `);
  return { id: result.recordset[0].Id, referenceNumber, token };
}

(async () => {
  const pool = await sql.connect({ connectionString: connStr });

  const facilities = (await pool.request().query(
    `SELECT Id, BusinessName, FacilityType, FacilityProvince, Email, AbattoirOwnerName
     FROM ConsolidatedMasterAbattoirDatabase
     ORDER BY Id`
  )).recordset;
  console.log('facilities: ' + facilities.length);

  const inspectors = (await pool.request().query(
    "SELECT Id, FirstName, LastName FROM Users WHERE Role = 'Inspector' ORDER BY Id"
  )).recordset;
  if (inspectors.length === 0) { console.error('no inspectors'); process.exit(1); }
  console.log('inspectors: ' + inspectors.length);

  // Wipe any existing EPVs for 2025-01..2026-03 so this is idempotent
  console.log('clearing existing EPVs in the target windows...');
  await pool.request().query(`
    DELETE a FROM EPVAuditLog a
    INNER JOIN EggProductionVerifications e ON a.VerificationId = e.Id
    WHERE (e.PeriodYear = 2025)
       OR (e.PeriodYear = 2026 AND e.PeriodMonth <= 3)
  `);
  await pool.request().query(`
    DELETE FROM EPVInvoices
    WHERE VerificationId IN (
      SELECT Id FROM EggProductionVerifications
      WHERE (PeriodYear = 2025)
         OR (PeriodYear = 2026 AND PeriodMonth <= 3)
    )
  `);
  await pool.request().query(`
    DELETE FROM EggProductionVerifications
    WHERE (PeriodYear = 2025)
       OR (PeriodYear = 2026 AND PeriodMonth <= 3)
  `);

  const refCounter = {}; // seq per YYYY-MM

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    let facilityEpvCount = 0, inspectorEpvCount = 0;

    for (const f of facilities) {
      let openingStock = 20000; // starting opening stock

      const yearPlan = [
        { year: 2025, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], completeInspector: true, verified: true },
        { year: 2026, months: [1, 2, 3],                              completeInspector: false, verified: false },
      ];

      for (const plan of yearPlan) {
        for (const month of plan.months) {
          const figures = generateMonthlyFigures(openingStock);

          const inspector = inspectors[rand(0, inspectors.length - 1)];
          const inspectorName = `${inspector.FirstName} ${inspector.LastName}`;

          const facEpv = await insertEpv(tx, refCounter, {
            clientId: f.Id,
            year: plan.year,
            month,
            status: 'Completed',
            isVerified: plan.verified,
            verifiedBy: plan.verified ? inspectorName : null,
            businessName: f.BusinessName,
            facilityType: f.FacilityType || 'Producer',
            facilityProvince: f.FacilityProvince || 'Gauteng',
            email: f.Email || '',
            ownerName: f.AbattoirOwnerName || '',
            epvType: 'Client',
            linkedEpvId: null,
            inspectorId: null,
            figures,
            completedBy: f.AbattoirOwnerName || 'Facility User',
          });
          facilityEpvCount++;

          if (plan.completeInspector) {
            // Inspector captures matching figures with small variance
            const inspectorFigures = {
              ...figures,
              // tiny +/- 1% variance
              soldToTrade: Math.max(0, figures.soldToTrade + rand(-50, 50)),
            };
            const recomputedD =
              inspectorFigures.soldToTrade + inspectorFigures.soldToStaff + inspectorFigures.soldThroughFarmStall;
            inspectorFigures.totalD = recomputedD;
            inspectorFigures.levyAmount = Math.round(inspectorFigures.soldToTrade * LEVY_RATE * 100) / 100;

            await insertEpv(tx, refCounter, {
              clientId: f.Id,
              year: plan.year,
              month,
              status: 'Completed',
              isVerified: false, // inspector EPV itself isn't a verified flag
              verifiedBy: null,
              businessName: f.BusinessName,
              facilityType: f.FacilityType || 'Producer',
              facilityProvince: f.FacilityProvince || 'Gauteng',
              email: f.Email || '',
              ownerName: f.AbattoirOwnerName || '',
              epvType: 'Inspector',
              linkedEpvId: facEpv.id,
              inspectorId: inspector.Id,
              figures: inspectorFigures,
              completedBy: inspectorName,
            });
            inspectorEpvCount++;
          }

          openingStock = Math.max(0, figures.actualClosingStock);
        }
      }

      process.stdout.write(`\r  seeded ${facilityEpvCount} facility + ${inspectorEpvCount} inspector EPVs`);
    }

    await tx.commit();
    console.log('\n');
    console.log('Done: ' + facilityEpvCount + ' facility EPVs, ' + inspectorEpvCount + ' inspector EPVs.');
    process.exit(0);
  } catch (err) {
    console.error('ERROR - rolling back:', err.message);
    await tx.rollback();
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(1); });
