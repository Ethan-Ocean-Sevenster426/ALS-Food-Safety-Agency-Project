const express = require('express');
const { sql, getPool } = require('../config/db');

const router = express.Router();

// GET /api/dashboard/stats
router.get('/stats', async (req, res) => {
  try {
    const pool = await getPool();

    // Total users
    const usersResult = await pool.request().query(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN IsActive = 1 OR IsActive IS NULL THEN 1 ELSE 0 END) AS active FROM Users'
    );

    // Users by role
    const roleResult = await pool.request().query(
      "SELECT Role, COUNT(*) AS count FROM Users GROUP BY Role ORDER BY CASE Role WHEN 'Super Admin' THEN 1 WHEN 'Admin' THEN 2 WHEN 'Company Admin' THEN 3 ELSE 4 END"
    );

    // Total clients
    const clientsResult = await pool.request().query(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN VerifiedAt IS NOT NULL THEN 1 ELSE 0 END) AS verified FROM ConsolidatedMasterAbattoirDatabase'
    );

    // EPV stats
    let epvStats = { total: 0, pending: 0, completed: 0 };
    try {
      const epvResult = await pool.request().query(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN Status = 'Pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN Status = 'Completed' THEN 1 ELSE 0 END) AS completed FROM EggProductionVerifications"
      );
      epvStats = epvResult.recordset[0];
    } catch (e) { /* table may not exist */ }

    // Support ticket stats
    let ticketStats = { total: 0, open: 0, inProgress: 0, resolved: 0, closed: 0 };
    try {
      const ticketResult = await pool.request().query(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN Status = 'Open' THEN 1 ELSE 0 END) AS [open], SUM(CASE WHEN Status = 'In Progress' THEN 1 ELSE 0 END) AS inProgress, SUM(CASE WHEN Status = 'Resolved' THEN 1 ELSE 0 END) AS resolved, SUM(CASE WHEN Status = 'Closed' THEN 1 ELSE 0 END) AS closed FROM SupportTickets"
      );
      ticketStats = ticketResult.recordset[0];
    } catch (e) { /* table may not exist */ }

    // Pending invitations
    let pendingInvites = 0;
    try {
      const inviteResult = await pool.request().query(
        "SELECT COUNT(*) AS total FROM Invitations WHERE Status = 'Pending'"
      );
      pendingInvites = inviteResult.recordset[0].total;
    } catch (e) { /* table may not exist */ }

    // Recent users (last 5)
    const recentUsers = await pool.request().query(
      'SELECT TOP 5 FirstName, LastName, Email, Role, CreatedAt FROM Users ORDER BY CreatedAt DESC'
    );

    // Recent tickets (last 5)
    let recentTickets = [];
    try {
      const rtResult = await pool.request().query(`
        SELECT TOP 5 t.Id, t.Subject, t.Priority, t.Status, t.CreatedAt,
               c.Name AS CategoryName,
               u.FirstName + ' ' + u.LastName AS CreatedByName
        FROM SupportTickets t
        JOIN SupportTicketCategories c ON t.CategoryId = c.Id
        JOIN Users u ON t.CreatedByUserId = u.Id
        ORDER BY t.CreatedAt DESC
      `);
      recentTickets = rtResult.recordset;
    } catch (e) { /* table may not exist */ }

    res.json({
      users: {
        total: usersResult.recordset[0].total,
        active: usersResult.recordset[0].active,
        byRole: roleResult.recordset,
      },
      clients: {
        total: clientsResult.recordset[0].total,
        verified: clientsResult.recordset[0].verified,
        unverified: clientsResult.recordset[0].total - clientsResult.recordset[0].verified,
      },
      epv: epvStats,
      tickets: ticketStats,
      pendingInvites,
      recentUsers: recentUsers.recordset,
      recentTickets,
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
