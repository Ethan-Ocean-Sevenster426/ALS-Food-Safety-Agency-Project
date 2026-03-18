const sql = require('mssql/msnodesqlv8');
const XLSX = require('xlsx');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connStr = `Driver={ODBC Driver 18 for SQL Server};Server=${process.env.DB_SERVER};Database=${process.env.DB_NAME};Trusted_Connection=Yes;TrustServerCertificate=Yes;`;

async function importData() {
  let pool;
  try {
    pool = await sql.connect({ connectionString: connStr });

    // Create the table if it doesn't exist
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ConsolidatedMasterAbattoirDatabase' AND xtype='U')
      BEGIN
        CREATE TABLE ConsolidatedMasterAbattoirDatabase (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          ClientID NVARCHAR(20) NOT NULL,
          BusinessName NVARCHAR(255) NOT NULL,
          AccountCode NVARCHAR(100) NOT NULL,
          Email NVARCHAR(255),
          ManualEmail NVARCHAR(255),
          Town NVARCHAR(255),
          CorporateGroup NVARCHAR(255),
          GroupType NVARCHAR(255),
          FacilityType NVARCHAR(255),
          CreatedAt DATETIME DEFAULT GETDATE()
        )
      END
    `);
    console.log('ConsolidatedMasterAbattoirDatabase table ensured.');

    // Read Excel file
    const xlsxPath = path.join(__dirname, '..', '..', 'Client_Allocation_Sheet.xlsx');
    const wb = XLSX.readFile(xlsxPath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    console.log(`Read ${rows.length} rows from Excel.`);

    // Clear existing data to avoid duplicates on re-run
    await pool.request().query('DELETE FROM ConsolidatedMasterAbattoirDatabase');

    // Insert in batches of 500
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const values = batch.map((row) => {
        const esc = (v) => String(v || '').replace(/'/g, "''");
        return `(N'${esc(row['Client ID'])}', N'${esc(row['Business Name'])}', N'${esc(row['Account Code'])}', N'${esc(row['Email'])}', N'${esc(row['Manual Email'])}', N'${esc(row['Town'])}', N'${esc(row['Corporate Group'])}', N'${esc(row['Group Type'])}', N'${esc(row['Facility Type'])}')`;
      }).join(',\n');

      await pool.request().query(`
        INSERT INTO ConsolidatedMasterAbattoirDatabase
          (ClientID, BusinessName, AccountCode, Email, ManualEmail, Town, CorporateGroup, GroupType, FacilityType)
        VALUES ${values}
      `);
      console.log(`Inserted rows ${i + 1} to ${Math.min(i + batchSize, rows.length)}`);
    }

    console.log(`Done! ${rows.length} rows imported into ConsolidatedMasterAbattoirDatabase.`);
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

importData();
