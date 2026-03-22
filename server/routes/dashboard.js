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

// GET /api/dashboard/epv-overview  — holistic EPV data for Super Admin dashboard
router.get('/epv-overview', async (req, res) => {
  try {
    const pool = await getPool();
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();
    const curQuarter = Math.ceil(curMonth / 3);
    const qStartMonth = (curQuarter - 1) * 3 + 1;

    // 1. Aggregate stats
    const statsResult = await pool.request().query(`
      SELECT
        COUNT(DISTINCT e.ClientRecordId) AS TotalFacilitiesWithEPV,
        COUNT(e.Id) AS TotalEPVs,
        SUM(CASE WHEN e.IsReconciled = 1 THEN 1 ELSE 0 END) AS ReconciledCount,
        SUM(ISNULL(e.LevyAmount, 0)) AS TotalEggLevy,
        SUM(ISNULL(e.PulpSoldToTrade, 0) * 1.7 * 0.018) AS TotalPulpLevy,
        SUM(ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * 0.018, 0)) AS TotalBilled,
        SUM(ISNULL(e.ReconciledAmount, 0)) AS TotalPaid,
        SUM(ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * 0.018, 0) - ISNULL(e.ReconciledAmount, 0)) AS TotalOutstanding,
        SUM(ISNULL(e.SoldToTrade, 0)) AS TotalEggDozens,
        SUM(ISNULL(e.PulpSoldToTrade, 0)) AS TotalPulpDozens,
        SUM(CASE WHEN ie.Id IS NOT NULL THEN 1 ELSE 0 END) AS TotalRejections,
        SUM(CASE WHEN e.ManualInspection = 1 THEN 1 ELSE 0 END) AS ManualInspections,
        SUM(CASE WHEN e.IsVerified = 1 THEN 1 ELSE 0 END) AS VerifiedCount
      FROM EggProductionVerifications e
      JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
      LEFT JOIN EggProductionVerifications ie ON ie.LinkedEPVId = e.Id AND ie.EPVType = 'Inspector'
      WHERE e.EPVType = 'Client' AND e.Status = 'Completed'
    `);

    // 2. Monthly breakdown
    const monthlyResult = await pool.request().query(`
      SELECT
        e.PeriodMonth, e.PeriodYear,
        COUNT(e.Id) AS EPVCount,
        SUM(ISNULL(e.LevyAmount, 0)) AS EggLevy,
        SUM(ISNULL(e.PulpSoldToTrade, 0) * 1.7 * 0.018) AS PulpLevy,
        SUM(ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * 0.018, 0)) AS TotalBilled,
        SUM(ISNULL(e.ReconciledAmount, 0)) AS TotalPaid,
        SUM(CASE WHEN e.IsReconciled = 1 THEN 1 ELSE 0 END) AS PaidCount,
        SUM(ISNULL(e.SoldToTrade, 0)) AS EggDozens,
        SUM(ISNULL(e.PulpSoldToTrade, 0)) AS PulpDozens,
        SUM(CASE WHEN ie.Id IS NOT NULL THEN 1 ELSE 0 END) AS Rejections
      FROM EggProductionVerifications e
      JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
      LEFT JOIN EggProductionVerifications ie ON ie.LinkedEPVId = e.Id AND ie.EPVType = 'Inspector'
      WHERE e.EPVType = 'Client' AND e.Status = 'Completed'
      GROUP BY e.PeriodMonth, e.PeriodYear
      ORDER BY e.PeriodYear DESC, e.PeriodMonth DESC
    `);

    // 3. Facilities by province
    const facByProvResult = await pool.request().query(`
      SELECT c.FacilityProvince, COUNT(DISTINCT c.Id) AS FacilityCount
      FROM ConsolidatedMasterAbattoirDatabase c
      WHERE c.FacilityProvince IS NOT NULL
      GROUP BY c.FacilityProvince
      ORDER BY c.FacilityProvince
    `);

    // 4. Need visit this quarter
    const needVisitResult = await pool.request()
      .input('qStart', sql.Int, qStartMonth)
      .input('qEnd', sql.Int, qStartMonth + 2)
      .input('year', sql.Int, curYear)
      .query(`
        SELECT COUNT(*) AS NeedVisitCount
        FROM ConsolidatedMasterAbattoirDatabase c
        WHERE c.FacilityProvince IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM EggProductionVerifications e
            WHERE e.ClientRecordId = c.Id
              AND e.EPVType = 'Client'
              AND e.PeriodYear = @year
              AND e.PeriodMonth BETWEEN @qStart AND @qEnd
              AND e.ManualInspection = 1
          )
      `);

    // 5. Outstanding facility count
    const outstandingResult = await pool.request().query(`
      SELECT COUNT(DISTINCT c.Id) AS OutstandingCount
      FROM EggProductionVerifications e
      JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
      WHERE e.EPVType = 'Client' AND e.Status = 'Completed'
        AND (e.IsReconciled = 0 OR e.IsReconciled IS NULL)
        AND (ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * 0.018, 0) - ISNULL(e.ReconciledAmount, 0)) > 0
    `);

    // 6. Pending approvals count
    const pendingApprovalsResult = await pool.request().query(`
      SELECT COUNT(*) AS PendingCount
      FROM EggProductionVerifications e
      LEFT JOIN EggProductionVerifications ie ON ie.LinkedEPVId = e.Id AND ie.EPVType = 'Inspector'
      WHERE e.EPVType = 'Client' AND e.Status = 'Completed' AND ie.Id IS NULL AND (e.IsVerified = 0 OR e.IsVerified IS NULL)
    `);

    // 7. Inspector EPVs to complete count
    const inspToCompleteResult = await pool.request().query(`
      SELECT COUNT(*) AS ToCompleteCount
      FROM EggProductionVerifications e
      JOIN EggProductionVerifications ie ON ie.LinkedEPVId = e.Id AND ie.EPVType = 'Inspector'
      WHERE e.EPVType = 'Client' AND e.Status = 'Completed' AND ie.Status = 'Pending'
    `);

    // 8. Not completed EPVs count (current year)
    let notCompletedCount = 0;
    for (let m = 1; m <= curMonth; m++) {
      const r = await pool.request()
        .input('month', sql.Int, m)
        .input('yr', sql.Int, curYear)
        .query(`
          SELECT COUNT(*) AS cnt
          FROM ConsolidatedMasterAbattoirDatabase c
          WHERE c.FacilityProvince IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM EggProductionVerifications e
              WHERE e.ClientRecordId = c.Id AND e.EPVType = 'Client'
                AND e.PeriodYear = @yr AND e.PeriodMonth = @month AND e.Status = 'Completed'
            )
        `);
      notCompletedCount += r.recordset[0].cnt;
    }

    // 9. Rejections by province
    const rejByProvResult = await pool.request().query(`
      SELECT c.FacilityProvince, COUNT(ie.Id) AS Rejections
      FROM EggProductionVerifications e
      JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
      JOIN EggProductionVerifications ie ON ie.LinkedEPVId = e.Id AND ie.EPVType = 'Inspector'
      WHERE e.EPVType = 'Client' AND e.Status = 'Completed'
      GROUP BY c.FacilityProvince
      ORDER BY Rejections DESC
    `);

    const totalFacilities = facByProvResult.recordset.reduce((a, b) => a + b.FacilityCount, 0);

    res.json({
      stats: statsResult.recordset[0],
      monthly: monthlyResult.recordset,
      facilitiesByProvince: facByProvResult.recordset,
      rejectionsByProvince: rejByProvResult.recordset,
      totalFacilities,
      needVisitCount: needVisitResult.recordset[0].NeedVisitCount,
      outstandingCount: outstandingResult.recordset[0].OutstandingCount,
      pendingApprovalsCount: pendingApprovalsResult.recordset[0].PendingCount,
      inspToCompleteCount: inspToCompleteResult.recordset[0].ToCompleteCount,
      notCompletedCount,
      quarter: { quarter: curQuarter, year: curYear, startMonth: qStartMonth, endMonth: qStartMonth + 2 },
    });
  } catch (err) {
    console.error('Dashboard EPV overview error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
