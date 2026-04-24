/**
 * Export the current DB state as a multi-sheet Excel "seed snapshot" so
 * other developers can see exactly what data the seed scripts produced.
 *
 * Output: server/seed-data/snapshot.xlsx (tracked by git).
 *
 * This is a READ-ONLY dump. Import is manual - run the seed scripts as
 * documented in README.
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { getPool } = require('../config/db');

const TABLES = [
  'Users',
  'Invitations',
  'ConsolidatedMasterAbattoirDatabase',
  'EggProductionVerifications',
  'EPVAuditLog',
  'EPVAttachments',
  'EPVInvoices',
  'ClientAuditLog',
  'LoginLog',
  'KPITargets',
  'SupportTicketCategories',
  'SupportTickets',
  'SupportTicketComments',
  'EmailSendLog',
];

// Strip PasswordHash so we never publish bcrypt hashes.
function scrub(name, rows) {
  if (name === 'Users') {
    return rows.map(r => {
      const { PasswordHash, ...rest } = r;
      return { ...rest, PasswordHash: '***REDACTED***' };
    });
  }
  return rows;
}

(async () => {
  const pool = await getPool();
  const outDir = path.join(__dirname, '..', 'seed-data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'snapshot.xlsx');

  const wb = XLSX.utils.book_new();
  for (const table of TABLES) {
    let rows = [];
    try {
      rows = (await pool.request().query(`SELECT * FROM [${table}]`)).recordset;
    } catch (e) {
      console.log(`  skip ${table}: ${e.message}`);
      continue;
    }
    rows = scrub(table, rows);
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
    if (rows.length > 0) {
      const cols = Object.keys(rows[0]);
      ws['!cols'] = cols.map(col => {
        let maxLen = col.length;
        for (const row of rows.slice(0, 100)) {
          const val = row[col];
          if (val != null) {
            const len = String(val).length;
            if (len > maxLen) maxLen = len;
          }
        }
        return { wch: Math.min(maxLen + 2, 50) };
      });
    }
    XLSX.utils.book_append_sheet(wb, ws, table.substring(0, 31));
    console.log(`  ${table}: ${rows.length}`);
  }

  XLSX.writeFile(wb, outPath);
  const size = fs.statSync(outPath).size;
  console.log(`\nWrote ${outPath} (${(size / 1024).toFixed(1)} KB)`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
