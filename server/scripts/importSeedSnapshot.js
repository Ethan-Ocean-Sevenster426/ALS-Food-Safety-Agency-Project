/**
 * Replay server/seed-data/snapshot.xlsx into the currently-configured DB.
 *
 * - Wipes and re-inserts every table contained in the snapshot.
 * - Preserves IDs via SET IDENTITY_INSERT.
 * - Regenerates PasswordHash for every user (snapshot redacts it).
 *   Default password: 'Password@123'; anthony@epvs.com gets 'StrongPassword123!'.
 *
 * Run (once, on a fresh DB that has already been initialised via
 * npm run init-db + every migration in server/scripts/):
 *
 *     node server/scripts/importSeedSnapshot.js
 */
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const sql = require('mssql/msnodesqlv8');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connStr =
  'Driver={ODBC Driver 18 for SQL Server};Server=' + process.env.DB_SERVER +
  ';Database=' + process.env.DB_NAME + ';Trusted_Connection=Yes;TrustServerCertificate=Yes;';

const SNAPSHOT = path.join(__dirname, '..', 'seed-data', 'snapshot.xlsx');

// Insert order: parents before children (respects FK constraints).
const INSERT_ORDER = [
  'KPITargets',
  'SupportTicketCategories',
  'Users',
  'ConsolidatedMasterAbattoirDatabase',
  'Invitations',
  'EggProductionVerifications',
  'EPVAuditLog',
  'EPVAttachments',
  'EPVInvoices',
  'ClientAuditLog',
  'LoginLog',
  'EmailSendLog',
  'SupportTickets',
  'SupportTicketComments',
];

// Delete order: children first.
const DELETE_ORDER = [...INSERT_ORDER].reverse();

const DEFAULT_PASSWORD = 'Password@123';
const SUPER_ADMIN_EMAIL = 'anthony@epvs.com';
const SUPER_ADMIN_PASSWORD = 'StrongPassword123!';

function loadSnapshot() {
  if (!fs.existsSync(SNAPSHOT)) {
    throw new Error('snapshot not found at ' + SNAPSHOT);
  }
  const wb = XLSX.readFile(SNAPSHOT, { cellDates: true });
  const out = {};
  for (const name of INSERT_ORDER) {
    const sheet = wb.Sheets[name];
    if (!sheet) { out[name] = []; continue; }
    // defval:null keeps empty cells as null (so SQL NULLs, not '')
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
    // Filter out completely blank placeholder rows (empty object or all-null)
    out[name] = rows.filter(r => Object.values(r).some(v => v !== null && v !== undefined && v !== ''));
  }
  return out;
}

async function regenerateUserHashes(users) {
  const defaultHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const superHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);
  for (const u of users) {
    u.PasswordHash = String(u.Email || '').toLowerCase() === SUPER_ADMIN_EMAIL ? superHash : defaultHash;
  }
}

async function bulkInsert(tx, table, rows) {
  if (rows.length === 0) { console.log('  ' + table + ': 0'); return; }

  const cols = Object.keys(rows[0]);
  const hasIdentity = cols.includes('Id');

  if (hasIdentity) {
    await new sql.Request(tx).query('SET IDENTITY_INSERT [' + table + '] ON');
  }

  for (const row of rows) {
    const req = new sql.Request(tx);
    const params = cols.map((c, i) => {
      req.input('p' + i, row[c]);
      return '@p' + i;
    });
    await req.query(
      'INSERT INTO [' + table + '] (' + cols.map(c => '[' + c + ']').join(',') + ') ' +
      'VALUES (' + params.join(',') + ')'
    );
  }

  if (hasIdentity) {
    await new sql.Request(tx).query('SET IDENTITY_INSERT [' + table + '] OFF');
  }

  console.log('  ' + table + ': ' + rows.length);
}

async function wipe(tx, table) {
  try {
    await new sql.Request(tx).query('DELETE FROM [' + table + ']');
    // Reset identity so IDs from the snapshot match exactly
    await new sql.Request(tx).query(
      "IF EXISTS (SELECT 1 FROM sys.identity_columns WHERE OBJECT_NAME(object_id) = '" + table + "') " +
      "DBCC CHECKIDENT ('" + table + "', RESEED, 0)"
    );
  } catch (e) {
    if (!/Invalid object name/i.test(e.message)) throw e;
    // Table doesn't exist - skip
  }
}

(async () => {
  console.log('Loading snapshot from ' + SNAPSHOT);
  const data = loadSnapshot();

  if (data.Users.length > 0) {
    await regenerateUserHashes(data.Users);
    console.log('  regenerated ' + data.Users.length + ' password hashes');
  }

  const pool = await sql.connect({ connectionString: connStr });
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    console.log('\nWiping existing rows (children first)...');
    for (const table of DELETE_ORDER) {
      await wipe(tx, table);
    }

    console.log('\nInserting snapshot rows (parents first)...');
    for (const table of INSERT_ORDER) {
      await bulkInsert(tx, table, data[table] || []);
    }

    await tx.commit();
    console.log('\nImport complete.');
    console.log("Default passwords:");
    console.log("  " + SUPER_ADMIN_EMAIL + " -> " + SUPER_ADMIN_PASSWORD);
    console.log("  everyone else -> " + DEFAULT_PASSWORD);
    process.exit(0);
  } catch (err) {
    console.error('\nERROR - rolling back:', err.message);
    await tx.rollback();
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(1); });
