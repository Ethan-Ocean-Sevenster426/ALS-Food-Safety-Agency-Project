/**
 * Monthly EPV auto-sender.
 * Runs at server startup and every 24 hours: for each facility with
 * EPVCycleStatus = 'On EPV Cycle', if no EPV exists yet for the previous
 * calendar month, create one and email the facility.
 *
 * Idempotent: the existing-EPV check inside sendEPVForFacility prevents
 * duplicate sends within the same period, so daily ticks are safe.
 */
const { getPool } = require('../config/db');
const { sendEPVForFacility, previousMonthPeriod } = require('../routes/epv');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function runEPVScheduledSends() {
  const startedAt = new Date();
  const { month, year } = previousMonthPeriod(startedAt);
  console.log(`[EPV Scheduler] ${startedAt.toISOString()} - checking for ${year}-${String(month).padStart(2, '0')} sends...`);

  let sent = 0, skipped = 0, failed = 0;
  try {
    const pool = await getPool();
    const facilities = (await pool.request().query(
      `SELECT * FROM ConsolidatedMasterAbattoirDatabase
       WHERE EPVCycleStatus = 'On EPV Cycle'`
    )).recordset;

    for (const client of facilities) {
      try {
        const result = await sendEPVForFacility({
          pool,
          client,
          periodMonth: month,
          periodYear: year,
          sentBy: 'System Scheduler',
          userRole: 'System',
        });
        if (result.alreadyExists) skipped++;
        else if (result.ok) { sent++;
          console.log(`[EPV Scheduler]   sent ${result.referenceNumber} to ${client.BusinessName} (${result.succeeded.length} recipients)`);
        } else { failed++;
          console.warn(`[EPV Scheduler]   FAILED ${client.BusinessName}: ${result.error}`);
        }
      } catch (e) {
        failed++;
        console.error(`[EPV Scheduler]   ERROR ${client.BusinessName}:`, e.message);
      }
    }

    console.log(`[EPV Scheduler] done: sent=${sent}, skipped=${skipped}, failed=${failed}, total on cycle=${facilities.length}`);
  } catch (err) {
    console.error('[EPV Scheduler] fatal:', err.message);
  }
}

function startEPVScheduler() {
  // Run shortly after startup (give the server time to settle), then once per day.
  setTimeout(runEPVScheduledSends, 30 * 1000);
  setInterval(runEPVScheduledSends, ONE_DAY_MS);
  console.log('[EPV Scheduler] started — first run in 30s, then every 24h.');
}

module.exports = { startEPVScheduler, runEPVScheduledSends };
