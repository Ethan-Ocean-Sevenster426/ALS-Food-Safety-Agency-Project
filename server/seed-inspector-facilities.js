/**
 * Seed one fictional facility per Inspector. Facility name: "<First>'s Abattoir".
 * Province is taken from Users.InspectorProvince when set.
 */
const sql = require('mssql/msnodesqlv8');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const connStr =
  'Driver={ODBC Driver 18 for SQL Server};Server=' + process.env.DB_SERVER +
  ';Database=' + process.env.DB_NAME + ';Trusted_Connection=Yes;TrustServerCertificate=Yes;';

const FACILITY_TYPES = ['Producer', 'Re-Packer', 'Breaking Plant'];
const TOWNS_BY_PROVINCE = {
  'Gauteng': 'Johannesburg',
  'Western Cape': 'Cape Town',
  'KwaZulu-Natal': 'Durban',
  'Eastern Cape': 'Gqeberha',
  'Limpopo': 'Polokwane',
  'Mpumalanga': 'Mbombela',
  'Free State': 'Bloemfontein',
  'North West': 'Mahikeng',
  'Northern Cape': 'Kimberley',
};

function pad(n, len) { return String(n).padStart(len, '0'); }

(async () => {
  const pool = await sql.connect({ connectionString: connStr });

  const inspectors = (await pool.request().query(
    "SELECT Id, FirstName, LastName, InspectorProvince FROM Users WHERE Role = 'Inspector' ORDER BY Id"
  )).recordset;

  console.log('Found ' + inspectors.length + ' inspectors.');

  let created = 0, skipped = 0;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (let i = 0; i < inspectors.length; i++) {
      const insp = inspectors[i];
      const businessName = insp.FirstName + "'s Abattoir";

      const exists = await new sql.Request(tx)
        .input('name', sql.NVarChar, businessName)
        .query('SELECT Id FROM ConsolidatedMasterAbattoirDatabase WHERE BusinessName = @name');
      if (exists.recordset.length > 0) {
        console.log('  skip (exists): ' + businessName);
        skipped++;
        continue;
      }

      const province = insp.InspectorProvince || 'Gauteng';
      const town = TOWNS_BY_PROVINCE[province] || 'Pretoria';
      const facilityType = FACILITY_TYPES[i % FACILITY_TYPES.length];
      const slug = (insp.FirstName + insp.LastName).toLowerCase().replace(/[^a-z]/g, '');
      const domain = slug + '.co.za';
      const code = 'INSP-' + pad(i + 1, 3);

      const fields = {
        BusinessName: businessName,
        AccountCode: code,
        Email: 'info@' + domain,
        Town: town,
        FacilityType: facilityType,
        FacilityProvince: province,
        CompanyRegNumber: '2021/' + pad(100000 + i, 6) + '/07',
        PhysicalAddress: (i + 10) + ' Farm Road, ' + town + ', ' + province,
        VATNumber: '4' + pad(100000000 + i, 9),
        AbattoirOwnerName: insp.FirstName + ' ' + insp.LastName,
        AbattoirOwnerCell: '082 ' + pad(100 + i, 3) + ' ' + pad(1000 + i, 4),
        AbattoirOwnerEmail: 'owner@' + domain,
        AccountsContactName: 'Accounts Manager',
        AccountsTelephone: '011 ' + pad(200 + i, 3) + ' ' + pad(2000 + i, 4),
        AccountsEmail: 'accounts@' + domain,
        AbattoirManagerName: 'Site Manager',
        AbattoirManagerCell: '083 ' + pad(300 + i, 3) + ' ' + pad(3000 + i, 4),
        AbattoirManagerEmail: 'manager@' + domain,
      };

      const cols = Object.keys(fields);
      const r = new sql.Request(tx);
      cols.forEach((c, idx) => r.input('f' + idx, sql.NVarChar, fields[c]));
      const colSql = cols.join(', ');
      const valSql = cols.map((_, idx) => '@f' + idx).join(', ');
      const result = await r.query(
        'INSERT INTO ConsolidatedMasterAbattoirDatabase (' + colSql + ') OUTPUT INSERTED.Id VALUES (' + valSql + ')'
      );
      console.log('  created Id=' + result.recordset[0].Id + ' ' + businessName + ' (' + facilityType + ', ' + province + ')');
      created++;
    }
    await tx.commit();
  } catch (err) {
    console.error('ERROR — rolling back:', err.message);
    await tx.rollback();
    process.exit(1);
  }

  console.log('\nCreated ' + created + ', skipped ' + skipped + '.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
