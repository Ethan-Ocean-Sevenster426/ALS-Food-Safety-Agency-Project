const express = require('express');
const { sql, getPool } = require('../config/db');
const { sendEmail } = require('../services/emailService');

const router = express.Router();

const EMAIL_HEADER = `
  <div style="background: rgb(30, 41, 59); padding: 24px 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="color: #fff; margin: 0; font-size: 24px;">EPVS Support</h1>
    <p style="color: rgba(255,255,255,0.7); margin: 6px 0 0; font-size: 13px;">Egg Production Verification System</p>
  </div>`;

const EMAIL_FOOTER = `
  <p style="color: #aaa; font-size: 11px; text-align: center; margin-top: 20px;">
    This is an automated message from the EPVS Support System. Please do not reply directly to this email.
  </p>`;

function wrapEmail(content) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      ${EMAIL_HEADER}
      <div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        ${content}
      </div>
      ${EMAIL_FOOTER}
    </div>`;
}

// GET /api/support/categories
router.get('/categories', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      'SELECT Id, Name, CategoryType FROM SupportTicketCategories WHERE IsActive = 1 ORDER BY SortOrder, Name'
    );
    res.json({ categories: result.recordset });
  } catch (err) {
    console.error('Fetch categories error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// POST /api/support/tickets - create a ticket
router.post('/tickets', async (req, res) => {
  const { categoryId, subject, description, priority, userId, clientRecordId } = req.body;

  if (!categoryId || !subject || !userId) {
    return res.status(400).json({ message: 'Category, subject, and user are required.' });
  }

  try {
    const pool = await getPool();

    // Get category info
    const catResult = await pool.request()
      .input('catId', sql.Int, categoryId)
      .query('SELECT Name, CategoryType FROM SupportTicketCategories WHERE Id = @catId');

    if (catResult.recordset.length === 0) {
      return res.status(400).json({ message: 'Invalid category.' });
    }

    const categoryType = catResult.recordset[0].CategoryType;
    const categoryName = catResult.recordset[0].Name;

    const insertResult = await pool.request()
      .input('categoryId', sql.Int, categoryId)
      .input('categoryType', sql.NVarChar, categoryType)
      .input('subject', sql.NVarChar, subject)
      .input('description', sql.NVarChar, description || '')
      .input('priority', sql.NVarChar, priority || 'Medium')
      .input('userId', sql.Int, userId)
      .input('clientRecordId', sql.Int, clientRecordId || null)
      .query(`
        INSERT INTO SupportTickets (CategoryId, CategoryType, Subject, Description, Priority, CreatedByUserId, ClientRecordId)
        OUTPUT INSERTED.Id
        VALUES (@categoryId, @categoryType, @subject, @description, @priority, @userId, @clientRecordId)
      `);

    const ticketId = insertResult.recordset[0].Id;

    // Get user email for notification
    const userResult = await pool.request()
      .input('userId', sql.Int, userId)
      .query('SELECT FirstName, Email FROM Users WHERE Id = @userId');

    if (userResult.recordset.length > 0) {
      const u = userResult.recordset[0];
      try {
        await sendEmail({
          to: u.Email,
          subject: `EPVS Support - Ticket #${ticketId} Received`,
          html: wrapEmail(`
            <h2 style="color: #1e293b; margin-top: 0;">Thank You, ${u.FirstName}!</h2>
            <p style="color: #555; font-size: 15px; line-height: 1.6;">
              Your support ticket has been received and logged. Our team will review it and get back to you shortly.
            </p>
            <div style="background: #f0f9f9; border: 1px solid #b8e4e4; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <table style="width: 100%; font-size: 14px; color: #374151;">
                <tr>
                  <td style="padding: 6px 0; font-weight: 600; width: 130px;">Ticket Reference:</td>
                  <td style="padding: 6px 0; color: #0E7C7B; font-weight: 700; font-size: 16px;">#${ticketId}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-weight: 600;">Issue Type:</td>
                  <td style="padding: 6px 0;">${categoryName}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-weight: 600;">Subject:</td>
                  <td style="padding: 6px 0;">${subject}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-weight: 600;">Priority:</td>
                  <td style="padding: 6px 0;">${priority || 'Medium'}</td>
                </tr>
              </table>
            </div>
            <p style="color: #555; font-size: 14px; line-height: 1.6;">
              You can view the status of your ticket at any time by navigating to the <strong>Support</strong> tab in the EPVS system.
            </p>
            <p style="color: #999; font-size: 13px;">
              Please use ticket reference <strong>#${ticketId}</strong> for any follow-up communication.
            </p>
          `),
        });
      } catch (emailErr) {
        console.error('Failed to send ticket confirmation email:', emailErr.message);
      }
    }

    res.status(201).json({ message: 'Support ticket created successfully.', ticketId });
  } catch (err) {
    console.error('Create ticket error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// GET /api/support/tickets - list tickets filtered by role
router.get('/tickets', async (req, res) => {
  const { userId, role, clientRecordId } = req.query;

  try {
    const pool = await getPool();
    let query = `
      SELECT t.Id, t.Subject, t.Description, t.Priority, t.Status, t.CategoryType,
             t.CreatedAt, t.UpdatedAt, t.ClientRecordId, t.AssignedToUserId,
             c.Name AS CategoryName,
             u.FirstName + ' ' + u.LastName AS CreatedByName,
             u.Email AS CreatedByEmail,
             a.FirstName + ' ' + a.LastName AS AssignedToName,
             cl.BusinessName AS CompanyName
      FROM SupportTickets t
      JOIN SupportTicketCategories c ON t.CategoryId = c.Id
      JOIN Users u ON t.CreatedByUserId = u.Id
      LEFT JOIN Users a ON t.AssignedToUserId = a.Id
      LEFT JOIN ConsolidatedMasterAbattoirDatabase cl ON t.ClientRecordId = cl.Id
    `;

    const request = pool.request();

    if (role === 'Super Admin') {
      query += ' ORDER BY t.CreatedAt DESC';
    } else if (role === 'Admin' || role === 'Super') {
      query += " WHERE t.CategoryType = 'Administration' ORDER BY t.CreatedAt DESC";
    } else {
      query += ' WHERE (t.CreatedByUserId = @userId';
      request.input('userId', sql.Int, parseInt(userId));
      if (clientRecordId) {
        query += ' OR t.ClientRecordId = @clientRecordId';
        request.input('clientRecordId', sql.Int, parseInt(clientRecordId));
      }
      query += ') ORDER BY t.CreatedAt DESC';
    }

    const result = await request.query(query);
    res.json({ tickets: result.recordset });
  } catch (err) {
    console.error('Fetch tickets error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// GET /api/support/tickets/:id - get single ticket with comments
router.get('/tickets/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await getPool();

    const ticketResult = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query(`
        SELECT t.*, c.Name AS CategoryName,
               u.FirstName + ' ' + u.LastName AS CreatedByName,
               u.Email AS CreatedByEmail,
               a.FirstName + ' ' + a.LastName AS AssignedToName,
               cl.BusinessName AS CompanyName
        FROM SupportTickets t
        JOIN SupportTicketCategories c ON t.CategoryId = c.Id
        JOIN Users u ON t.CreatedByUserId = u.Id
        LEFT JOIN Users a ON t.AssignedToUserId = a.Id
        LEFT JOIN ConsolidatedMasterAbattoirDatabase cl ON t.ClientRecordId = cl.Id
        WHERE t.Id = @id
      `);

    if (ticketResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Ticket not found.' });
    }

    const commentsResult = await pool.request()
      .input('ticketId', sql.Int, parseInt(id))
      .query(`
        SELECT sc.Id, sc.Comment, sc.CreatedAt,
               u.FirstName + ' ' + u.LastName AS UserName,
               u.Role AS UserRole
        FROM SupportTicketComments sc
        JOIN Users u ON sc.UserId = u.Id
        WHERE sc.TicketId = @ticketId
        ORDER BY sc.CreatedAt ASC
      `);

    res.json({
      ticket: ticketResult.recordset[0],
      comments: commentsResult.recordset,
    });
  } catch (err) {
    console.error('Fetch ticket error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// PUT /api/support/tickets/:id - update ticket (status, priority, assignment)
router.put('/tickets/:id', async (req, res) => {
  const { id } = req.params;
  const { status, priority, assignedToUserId } = req.body;

  try {
    const pool = await getPool();

    const sets = [];
    const request = pool.request().input('id', sql.Int, parseInt(id));

    if (status) {
      sets.push('Status = @status');
      request.input('status', sql.NVarChar, status);
    }
    if (priority) {
      sets.push('Priority = @priority');
      request.input('priority', sql.NVarChar, priority);
    }
    if (assignedToUserId !== undefined) {
      sets.push('AssignedToUserId = @assignedTo');
      request.input('assignedTo', sql.Int, assignedToUserId || null);
    }

    sets.push('UpdatedAt = GETDATE()');

    if (sets.length === 1) {
      return res.status(400).json({ message: 'No updates provided.' });
    }

    await request.query(`UPDATE SupportTickets SET ${sets.join(', ')} WHERE Id = @id`);

    // Send email if status changed to Closed
    if (status === 'Closed') {
      try {
        const ticketResult = await pool.request()
          .input('ticketId', sql.Int, parseInt(id))
          .query(`
            SELECT t.Id, t.Subject, c.Name AS CategoryName,
                   u.FirstName, u.Email
            FROM SupportTickets t
            JOIN SupportTicketCategories c ON t.CategoryId = c.Id
            JOIN Users u ON t.CreatedByUserId = u.Id
            WHERE t.Id = @ticketId
          `);

        if (ticketResult.recordset.length > 0) {
          const ticket = ticketResult.recordset[0];
          await sendEmail({
            to: ticket.Email,
            subject: `EPVS Support - Ticket #${ticket.Id} Closed`,
            html: wrapEmail(`
              <h2 style="color: #1e293b; margin-top: 0;">Ticket Closed</h2>
              <p style="color: #555; font-size: 15px; line-height: 1.6;">
                Hi ${ticket.FirstName}, your support ticket has been resolved and closed.
              </p>
              <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <table style="width: 100%; font-size: 14px; color: #374151;">
                  <tr>
                    <td style="padding: 6px 0; font-weight: 600; width: 130px;">Ticket Reference:</td>
                    <td style="padding: 6px 0; color: #0E7C7B; font-weight: 700; font-size: 16px;">#${ticket.Id}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-weight: 600;">Subject:</td>
                    <td style="padding: 6px 0;">${ticket.Subject}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-weight: 600;">Issue Type:</td>
                    <td style="padding: 6px 0;">${ticket.CategoryName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-weight: 600;">Status:</td>
                    <td style="padding: 6px 0; color: #16a34a; font-weight: 700;">Closed</td>
                  </tr>
                </table>
              </div>
              <p style="color: #555; font-size: 14px; line-height: 1.6;">
                If you believe this issue has not been fully resolved, please log a new ticket or contact our support team.
              </p>
              <p style="color: #999; font-size: 13px;">
                Thank you for using EPVS Support.
              </p>
            `),
          });
        }
      } catch (emailErr) {
        console.error('Failed to send ticket closed email:', emailErr.message);
      }
    }

    res.json({ message: 'Ticket updated.' });
  } catch (err) {
    console.error('Update ticket error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// POST /api/support/tickets/:id/comments - add a comment
router.post('/tickets/:id/comments', async (req, res) => {
  const { id } = req.params;
  const { userId, comment } = req.body;

  if (!userId || !comment) {
    return res.status(400).json({ message: 'User and comment are required.' });
  }

  try {
    const pool = await getPool();

    await pool.request()
      .input('ticketId', sql.Int, parseInt(id))
      .input('userId', sql.Int, userId)
      .input('comment', sql.NVarChar, comment)
      .query('INSERT INTO SupportTicketComments (TicketId, UserId, Comment) VALUES (@ticketId, @userId, @comment)');

    // Update ticket's UpdatedAt
    await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('UPDATE SupportTickets SET UpdatedAt = GETDATE() WHERE Id = @id');

    // Send email to ticket creator about the new comment
    try {
      const ticketInfo = await pool.request()
        .input('tid', sql.Int, parseInt(id))
        .query(`
          SELECT t.Id, t.Subject, u.FirstName, u.Email
          FROM SupportTickets t
          JOIN Users u ON t.CreatedByUserId = u.Id
          WHERE t.Id = @tid
        `);

      const commenterResult = await pool.request()
        .input('commenterId', sql.Int, userId)
        .query("SELECT FirstName + ' ' + LastName AS CommenterName, Role AS CommenterRole FROM Users WHERE Id = @commenterId");

      if (ticketInfo.recordset.length > 0 && commenterResult.recordset.length > 0) {
        const ticket = ticketInfo.recordset[0];
        const commenter = commenterResult.recordset[0];

        await sendEmail({
          to: ticket.Email,
          subject: `EPVS Support - New Comment on Ticket #${ticket.Id}`,
          html: wrapEmail(`
            <h2 style="color: #1e293b; margin-top: 0;">New Comment on Your Ticket</h2>
            <p style="color: #555; font-size: 15px; line-height: 1.6;">
              Hi ${ticket.FirstName}, a new comment has been added to your support ticket.
            </p>
            <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <table style="width: 100%; font-size: 14px; color: #374151; margin-bottom: 14px;">
                <tr>
                  <td style="padding: 4px 0; font-weight: 600; width: 130px;">Ticket Reference:</td>
                  <td style="padding: 4px 0; color: #0E7C7B; font-weight: 700;">#${ticket.Id}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; font-weight: 600;">Subject:</td>
                  <td style="padding: 4px 0;">${ticket.Subject}</td>
                </tr>
              </table>
              <div style="border-top: 1px solid #e5e7eb; padding-top: 14px;">
                <p style="margin: 0 0 6px; font-size: 13px; color: #6b7280;">
                  <strong style="color: #1f2937;">${commenter.CommenterName}</strong>
                  <span style="background: #e0f2f2; color: #065f5e; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; margin-left: 6px;">${commenter.CommenterRole}</span>
                </p>
                <p style="margin: 0; font-size: 14px; color: #374151; line-height: 1.6; background: #fff; padding: 12px; border-radius: 6px; border: 1px solid #e5e7eb;">
                  ${comment.replace(/\n/g, '<br>')}
                </p>
              </div>
            </div>
            <p style="color: #555; font-size: 14px; line-height: 1.6;">
              You can view and reply to this ticket by navigating to the <strong>Support</strong> tab in the EPVS system.
            </p>
          `),
        });
      }
    } catch (emailErr) {
      console.error('Failed to send comment notification email:', emailErr.message);
    }

    res.status(201).json({ message: 'Comment added.' });
  } catch (err) {
    console.error('Add comment error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
