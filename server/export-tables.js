/**
 * Export all database tables to individual Excel files
 * Usage: node export-tables.js
 * Output: server/exports/<TableName>.xlsx
 */
const sql = require('mssql/msnodesqlv8');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { getPool } = require('./config/db');

(async () => {
  const exportDir = path.join(__dirname, 'exports');
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const pool = await getPool();

  // Get all tables
  const tables = await pool.request().query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME"
  );

  for (const { TABLE_NAME } of tables.recordset) {
    console.log(`Exporting ${TABLE_NAME}...`);
    const result = await pool.request().query(`SELECT * FROM [${TABLE_NAME}]`);
    const rows = result.recordset;

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);

    // Auto-size columns
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

    XLSX.utils.book_append_sheet(wb, ws, TABLE_NAME.substring(0, 31)); // sheet name max 31 chars
    const filePath = path.join(exportDir, `${TABLE_NAME}.xlsx`);
    XLSX.writeFile(wb, filePath);
    console.log(`  -> ${filePath} (${rows.length} rows)`);
  }

  console.log('\nDone! All tables exported to server/exports/');
  process.exit(0);
})().catch(e => {
  console.error('Export failed:', e.message);
  process.exit(1);
});
