/**
 * Demo seed script — creates resolved/closed support tickets with comments.
 * NO emails are sent. Run once:  cd server && npx dotenv-cli -- node seed-tickets.js
 */
require('dotenv').config();
const sql = require('mssql/msnodesqlv8');

const config = {
  connectionString:
    'Driver={ODBC Driver 18 for SQL Server};Server=' +
    process.env.DB_SERVER + ';Database=' + process.env.DB_NAME +
    ';Trusted_Connection=yes;TrustServerCertificate=yes;',
};

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randDate(startYear, startMonth, endYear, endMonth) {
  const start = new Date(startYear, startMonth - 1, 1);
  const end = new Date(endYear, endMonth - 1, 28);
  const ms = start.getTime() + Math.random() * (end.getTime() - start.getTime());
  const d = new Date(ms);
  d.setHours(7 + rand(0, 10), rand(0, 59), rand(0, 59));
  return d;
}

// Realistic ticket templates per category
const TICKETS = [
  // Access/Permission Issue (5)
  { catId: 5, catType: 'Administration', subject: 'Cannot access Company Overview page', desc: 'I am logged in as Company Admin but the Company Overview page shows "Access Denied". I was able to access it yesterday.', priority: 'High' },
  { catId: 5, catType: 'Administration', subject: 'New employee needs access to EPV system', desc: 'We have a new accounts manager who needs User access to submit EPVs. Please advise on how to set this up.', priority: 'Medium' },
  { catId: 5, catType: 'Administration', subject: 'Locked out after password change', desc: 'Changed my password this morning and now cannot log in. The system says invalid credentials.', priority: 'High' },

  // User Registration/Invitation (10)
  { catId: 10, catType: 'Administration', subject: 'Invitation email not received', desc: 'Our new staff member was invited 3 days ago but has not received the invitation email. Email: test.user@facility.co.za', priority: 'Medium' },
  { catId: 10, catType: 'Administration', subject: 'Invitation link expired', desc: 'The invitation link I received shows as expired when I click on it. Can you please resend?', priority: 'Medium' },
  { catId: 10, catType: 'Administration', subject: 'Error during registration wizard', desc: 'When completing the business details wizard after accepting the invite, I get an error on step 3 when entering VAT number.', priority: 'High' },

  // Role or Permission Change (11)
  { catId: 11, catType: 'Administration', subject: 'Please upgrade user to Company Admin', desc: 'Our current Company Admin has left the company. Please change the role of thabo.m@facility.co.za to Company Admin.', priority: 'High' },
  { catId: 11, catType: 'Administration', subject: 'Remove user access', desc: 'Employee no longer works for us. Please deactivate their account: old.employee@facility.co.za', priority: 'Medium' },

  // EPV Submission Issue (12)
  { catId: 12, catType: 'Administration', subject: 'EPV form not saving data', desc: 'When I fill in Step 2 (Levy Eggs) and click Next, the data disappears when I go back. Numbers are not being saved between steps.', priority: 'High' },
  { catId: 12, catType: 'Administration', subject: 'Cannot submit EPV - button greyed out', desc: 'I have completed all 4 steps of the EPV but the Submit button on the Review page is greyed out. All fields appear to be filled in.', priority: 'High' },
  { catId: 12, catType: 'Administration', subject: 'EPV for wrong month', desc: 'I accidentally submitted the EPV for February instead of March. Can this be corrected?', priority: 'Medium' },
  { catId: 12, catType: 'Administration', subject: 'Duplicate EPV created', desc: 'The system allowed me to create two EPVs for the same month (January 2026). One of them should be deleted.', priority: 'Medium' },

  // EPV Data Incorrect (13)
  { catId: 13, catType: 'Administration', subject: 'Incorrect opening stock on EPV', desc: 'EPV-2025-06-0045: The opening stock shows 15,000 but our actual opening stock was 25,000 dozens. Please amend.', priority: 'High' },
  { catId: 13, catType: 'Administration', subject: 'Levy calculation seems wrong', desc: 'On EPV-2025-08-0102 the levy amount shows R450 but based on our sold to trade of 30,000 it should be R540 (30,000 × R0.018).', priority: 'Medium' },
  { catId: 13, catType: 'Administration', subject: 'Need to update pulp figures', desc: 'The pulp sold to trade figure was entered incorrectly. It should be 8,500 KG not 850 KG. Reference: EPV-2025-09-0078.', priority: 'Medium' },

  // EPV Status Not Updating (14)
  { catId: 14, catType: 'IT', subject: 'EPV still shows as Pending after submission', desc: 'I submitted EPV-2025-07-0034 two days ago but it still shows as Pending on the Company Overview. The form shows as completed.', priority: 'High' },
  { catId: 14, catType: 'IT', subject: 'Verification status not reflecting', desc: 'Inspector approved our EPV yesterday but the status still shows as unverified on our dashboard.', priority: 'Medium' },

  // Inspector Verification Issue (15)
  { catId: 15, catType: 'Administration', subject: 'Disagree with inspector rejection', desc: 'Our EPV-2025-10-0156 was rejected by the inspector but we believe our figures are correct. The inspector noted a discrepancy in eggs sold to trade but our delivery notes confirm the original amount.', priority: 'High' },
  { catId: 15, catType: 'Administration', subject: 'Inspector has not visited our facility', desc: 'We have not received any physical inspection visit this quarter despite being on the schedule. Our facility is in Limpopo.', priority: 'Medium' },
  { catId: 15, catType: 'Administration', subject: 'Question about verification process', desc: 'Can you explain what happens after the inspector verifies our EPV? Do we receive any notification?', priority: 'Low' },

  // Payment Status Issue (16)
  { catId: 16, catType: 'Administration', subject: 'Payment status incorrect', desc: 'Our EPV-2025-11-0089 shows as Not Paid but we made the payment via EFT on 15/11/2025. Reference: FNB-2025-1115.', priority: 'High' },
  { catId: 16, catType: 'Administration', subject: 'Query on outstanding amount', desc: 'The outstanding amount on our account shows R45,000 but we believe it should be R38,000 after our last payment.', priority: 'Medium' },

  // POP Upload Issue (17)
  { catId: 17, catType: 'IT', subject: 'Cannot upload proof of payment PDF', desc: 'When I try to upload our POP document (PDF, 2MB) I get an error: "Upload failed". I have tried multiple times.', priority: 'High' },
  { catId: 17, catType: 'IT', subject: 'Uploaded wrong POP document', desc: 'I accidentally uploaded the wrong PDF as proof of payment for EPV-2025-12-0201. Can an admin please delete it so I can upload the correct one?', priority: 'Medium' },

  // Reconciliation Issue (18)
  { catId: 18, catType: 'Administration', subject: 'Partial payment not reflected', desc: 'We made a partial payment of R15,000 towards our R28,000 levy but the system still shows the full amount as outstanding.', priority: 'High' },
  { catId: 18, catType: 'Administration', subject: 'Reconciliation query for multiple EPVs', desc: 'We made a single bulk payment of R120,000 covering EPVs from July to September 2025. How do we allocate this across the three months?', priority: 'Medium' },

  // Levy Calculation Query (19)
  { catId: 19, catType: 'Administration', subject: 'How is pulp levy calculated?', desc: 'Can you explain the pulp levy calculation? We sell 5,000 KG of pulp and want to understand the R0.018 × 1.7 multiplier.', priority: 'Low' },
  { catId: 19, catType: 'Administration', subject: 'Export eggs levy exemption query', desc: 'Are exported eggs subject to the R0.018 levy? Our EPV includes 10,000 dozens exported but we were told exports are exempt.', priority: 'Medium' },

  // Dashboard Data Incorrect (20)
  { catId: 20, catType: 'IT', subject: 'Dashboard showing wrong collection rate', desc: 'The collection rate on the dashboard shows 45% but when I manually calculate from the EPV list it should be around 65%.', priority: 'Medium' },
  { catId: 20, catType: 'IT', subject: 'Province chart not loading', desc: 'The "Facilities by Province" pie chart on the main dashboard is stuck on loading. All other charts display correctly.', priority: 'Low' },

  // Report Generation (6)
  { catId: 6, catType: 'IT', subject: 'Need monthly EPV summary report', desc: 'Is there a way to export a monthly summary of all EPVs per facility? We need this for our board meeting.', priority: 'Low' },

  // Company Overview Issue (21)
  { catId: 21, catType: 'Administration', subject: 'Company details showing old information', desc: 'Our business name changed from "XYZ Eggs" to "XYZ Egg Producers (Pty) Ltd" but the old name still shows. We updated it but it reverted.', priority: 'Medium' },
  { catId: 21, catType: 'Administration', subject: 'Cannot see EPV history', desc: 'When I go to Company Overview I can only see EPVs from 2026. The 2025 EPVs are not showing. Is there a filter I am missing?', priority: 'Low' },

  // Facility Information Update (22)
  { catId: 22, catType: 'Administration', subject: 'Update facility physical address', desc: 'We have moved to a new premises. Please update our address to: 45 Industrial Road, Midrand, Gauteng, 1685.', priority: 'Low' },
  { catId: 22, catType: 'Administration', subject: 'Facility type incorrect', desc: 'Our facility is listed as "Egg Re-packer" but we are actually a Producer. Please correct this.', priority: 'Medium' },

  // Province Assignment (23)
  { catId: 23, catType: 'Administration', subject: 'Province incorrectly assigned', desc: 'Our facility in Polokwane is assigned to Gauteng but it should be Limpopo. This affects our inspector assignments.', priority: 'Medium' },

  // Question/Help (8)
  { catId: 8, catType: 'Administration', subject: 'How to add EPV for previous month', desc: 'We missed submitting our EPV for October 2025. How do we create one for a past month?', priority: 'Low' },
  { catId: 8, catType: 'Administration', subject: 'Training request for new staff', desc: 'We have 3 new staff members who need training on the EPV system. Is there a user guide or can training be arranged?', priority: 'Low' },
  { catId: 8, catType: 'Administration', subject: 'What is the EPV deadline each month?', desc: 'By when must the EPV be completed each month? We want to make sure we submit on time.', priority: 'Low' },

  // Feature Request (4)
  { catId: 4, catType: 'IT', subject: 'Request: Email reminders for EPV due date', desc: 'It would be helpful to receive an automated email reminder a week before the EPV is due each month.', priority: 'Low' },
  { catId: 4, catType: 'IT', subject: 'Request: Bulk EPV export to Excel', desc: 'Can we have a feature to export all our EPV data to Excel for our internal reporting?', priority: 'Low' },

  // Performance/Speed (2)
  { catId: 2, catType: 'IT', subject: 'System very slow during morning hours', desc: 'Between 8am and 10am the system is extremely slow to load. Pages take 30+ seconds. This has been happening for the past week.', priority: 'Medium' },

  // System Error/Bug (1)
  { catId: 1, catType: 'IT', subject: 'Error 500 when opening EPV form', desc: 'When clicking on the EPV link from the email I get a white screen with "Server Error". This started today. EPV ref: EPV-2025-05-0067.', priority: 'High' },
  { catId: 1, catType: 'IT', subject: 'Numbers not formatting correctly', desc: 'On the EPV form, when I enter 25000 in the Sold to Trade field, it displays as 25,00 instead of 25,000. This is confusing.', priority: 'Medium' },

  // Other (9)
  { catId: 9, catType: 'Administration', subject: 'Request for levy statement', desc: 'Please provide a levy statement for our facility covering January to December 2025 for our auditors.', priority: 'Medium' },
  { catId: 9, catType: 'Administration', subject: 'Company registration number update', desc: 'Our company reg number was entered incorrectly during registration. It should be 2019/123456/07 not 2019/123465/07.', priority: 'Low' },
];

// Admin responses per category type
const ADMIN_RESPONSES = {
  initial: [
    'Thank you for reporting this. We are looking into it and will get back to you shortly.',
    'We have received your ticket and assigned it to the relevant team. You will be updated soon.',
    'Thank you for reaching out. Let me investigate this for you.',
    'We acknowledge your query and will respond within 24 hours.',
    'Thanks for letting us know. We are checking this on our side.',
  ],
  resolution: [
    'This has been resolved. Please try again and let us know if the issue persists.',
    'The issue has been fixed. You should now be able to proceed as normal.',
    'We have corrected this on our end. The changes should reflect immediately.',
    'This has been addressed. Please log out and log back in to see the update.',
    'Resolved. The data has been updated as requested.',
    'This is now sorted. Please verify on your side and confirm.',
    'Fixed. We identified the root cause and applied the correction.',
    'The update has been applied successfully. Please check and confirm.',
    'We have processed your request. Everything should now be in order.',
    'This has been taken care of. Do let us know if you need anything else.',
  ],
};

const USER_CONFIRMATIONS = [
  'Thank you, this is now working correctly.',
  'Confirmed, the issue is resolved. Thank you for the quick turnaround.',
  'All sorted now, thanks!',
  'I can confirm this has been fixed. Appreciate the help.',
  'Working as expected now. Thank you.',
  'Thanks for resolving this so quickly.',
];

async function seed() {
  const pool = await sql.connect(config);

  // Get users
  const admins = (await pool.request().query("SELECT Id, FirstName, LastName FROM Users WHERE Role = 'Admin'")).recordset;
  const superAdmin = (await pool.request().query("SELECT TOP 1 Id, FirstName, LastName FROM Users WHERE Role = 'Super Admin'")).recordset[0];
  const companyUsers = (await pool.request().query(
    `SELECT TOP 80 u.Id, u.FirstName, u.LastName, u.Role, i.ClientRecordId
     FROM Users u
     LEFT JOIN Invitations i ON LOWER(i.Email) = LOWER(u.Email) AND i.Status = 'Accepted'
     WHERE u.Role IN ('Company Admin', 'User')
     ORDER BY NEWID()`
  )).recordset;

  console.log(`Admins: ${admins.length}, Super Admin: ${superAdmin.FirstName}, Company users: ${companyUsers.length}`);

  // Clear existing tickets and comments
  try { await pool.request().query('DELETE FROM SupportTicketComments'); } catch(e) {}
  try { await pool.request().query('DELETE FROM SupportTickets'); } catch(e) {}
  console.log('Cleared existing tickets');

  let ticketsCreated = 0;
  let commentsCreated = 0;

  for (let i = 0; i < TICKETS.length; i++) {
    const t = TICKETS[i];
    const creator = companyUsers[i % companyUsers.length];
    const assignee = admins[rand(0, admins.length - 1)];

    // Random date between Feb 2025 and Feb 2026
    const created = randDate(2025, 2, 2026, 2);

    // 60% Closed, 40% Resolved
    const isClosed = Math.random() < 0.60;
    const status = isClosed ? 'Closed' : 'Resolved';

    // Updated date: 1-14 days after creation
    const updated = new Date(created);
    updated.setDate(updated.getDate() + rand(1, 14));

    const result = await pool.request()
      .input('catId', sql.Int, t.catId)
      .input('catType', sql.NVarChar, t.catType)
      .input('subject', sql.NVarChar, t.subject)
      .input('desc', sql.NVarChar, t.desc)
      .input('priority', sql.NVarChar, t.priority)
      .input('status', sql.NVarChar, status)
      .input('createdBy', sql.Int, creator.Id)
      .input('clientRecordId', sql.Int, creator.ClientRecordId || null)
      .input('assignedTo', sql.Int, assignee.Id)
      .input('createdAt', sql.DateTime, created)
      .input('updatedAt', sql.DateTime, updated)
      .query(`INSERT INTO SupportTickets
              (CategoryId, CategoryType, Subject, Description, Priority, Status,
               CreatedByUserId, ClientRecordId, AssignedToUserId, CreatedAt, UpdatedAt)
              OUTPUT INSERTED.Id
              VALUES (@catId, @catType, @subject, @desc, @priority, @status,
                      @createdBy, @clientRecordId, @assignedTo, @createdAt, @updatedAt)`);

    const ticketId = result.recordset[0].Id;
    ticketsCreated++;

    // Add comments: admin initial response
    const comment1Date = new Date(created);
    comment1Date.setDate(comment1Date.getDate() + rand(0, 1));
    comment1Date.setHours(comment1Date.getHours() + rand(1, 8));

    await pool.request()
      .input('ticketId', sql.Int, ticketId)
      .input('userId', sql.Int, assignee.Id)
      .input('comment', sql.NVarChar, ADMIN_RESPONSES.initial[rand(0, ADMIN_RESPONSES.initial.length - 1)])
      .input('createdAt', sql.DateTime, comment1Date)
      .query(`INSERT INTO SupportTicketComments (TicketId, UserId, Comment, CreatedAt)
              VALUES (@ticketId, @userId, @comment, @createdAt)`);
    commentsCreated++;

    // Add resolution comment from admin
    const comment2Date = new Date(comment1Date);
    comment2Date.setDate(comment2Date.getDate() + rand(1, 5));
    comment2Date.setHours(7 + rand(0, 9), rand(0, 59));

    await pool.request()
      .input('ticketId', sql.Int, ticketId)
      .input('userId', sql.Int, assignee.Id)
      .input('comment', sql.NVarChar, ADMIN_RESPONSES.resolution[rand(0, ADMIN_RESPONSES.resolution.length - 1)])
      .input('createdAt', sql.DateTime, comment2Date)
      .query(`INSERT INTO SupportTicketComments (TicketId, UserId, Comment, CreatedAt)
              VALUES (@ticketId, @userId, @comment, @createdAt)`);
    commentsCreated++;

    // ~70% get a user confirmation reply
    if (Math.random() < 0.70) {
      const comment3Date = new Date(comment2Date);
      comment3Date.setDate(comment3Date.getDate() + rand(0, 2));
      comment3Date.setHours(7 + rand(0, 10), rand(0, 59));

      await pool.request()
        .input('ticketId', sql.Int, ticketId)
        .input('userId', sql.Int, creator.Id)
        .input('comment', sql.NVarChar, USER_CONFIRMATIONS[rand(0, USER_CONFIRMATIONS.length - 1)])
        .input('createdAt', sql.DateTime, comment3Date)
        .query(`INSERT INTO SupportTicketComments (TicketId, UserId, Comment, CreatedAt)
                VALUES (@ticketId, @userId, @comment, @createdAt)`);
      commentsCreated++;
    }

    // Some tickets get an extra back-and-forth
    if (Math.random() < 0.25) {
      const extraDate = new Date(comment1Date);
      extraDate.setHours(extraDate.getHours() + rand(2, 12));

      const extraComments = [
        'Can you please provide your EPV reference number so we can look into this?',
        'Could you please confirm which facility this relates to?',
        'We need a bit more information. What browser are you using?',
        'Can you try clearing your browser cache and try again?',
        'Could you send us a screenshot of the error?',
      ];
      await pool.request()
        .input('ticketId', sql.Int, ticketId)
        .input('userId', sql.Int, assignee.Id)
        .input('comment', sql.NVarChar, extraComments[rand(0, extraComments.length - 1)])
        .input('createdAt', sql.DateTime, extraDate)
        .query(`INSERT INTO SupportTicketComments (TicketId, UserId, Comment, CreatedAt)
                VALUES (@ticketId, @userId, @comment, @createdAt)`);
      commentsCreated++;

      const replyDate = new Date(extraDate);
      replyDate.setHours(replyDate.getHours() + rand(1, 24));
      const userReplies = [
        'Sure, the reference is EPV-2025-08-0102.',
        'This is for our facility in Midrand, Gauteng.',
        'I am using Chrome on Windows 11.',
        'I cleared the cache and it is still happening.',
        'Screenshot attached. The error shows on the form page.',
        'It is our main facility — account code FA-IND-EGG-NA-0045.',
      ];
      await pool.request()
        .input('ticketId', sql.Int, ticketId)
        .input('userId', sql.Int, creator.Id)
        .input('comment', sql.NVarChar, userReplies[rand(0, userReplies.length - 1)])
        .input('createdAt', sql.DateTime, replyDate)
        .query(`INSERT INTO SupportTicketComments (TicketId, UserId, Comment, CreatedAt)
                VALUES (@ticketId, @userId, @comment, @createdAt)`);
      commentsCreated++;
    }
  }

  // Summary
  const statusBreakdown = (await pool.request().query(
    'SELECT Status, COUNT(*) as cnt FROM SupportTickets GROUP BY Status'
  )).recordset;
  const priorityBreakdown = (await pool.request().query(
    'SELECT Priority, COUNT(*) as cnt FROM SupportTickets GROUP BY Priority'
  )).recordset;

  console.log('\n========================================');
  console.log('TICKET SEED SUMMARY');
  console.log('========================================');
  console.log(`Tickets created:  ${ticketsCreated}`);
  console.log(`Comments created: ${commentsCreated}`);
  console.log('Status breakdown:');
  statusBreakdown.forEach(s => console.log(`  ${s.Status}: ${s.cnt}`));
  console.log('Priority breakdown:');
  priorityBreakdown.forEach(p => console.log(`  ${p.Priority}: ${p.cnt}`));
  console.log('========================================');
  console.log('NO emails sent.');

  process.exit();
}

seed().catch(e => { console.error('Seed error:', e); process.exit(1); });
