const express = require('express');
const { sql, getPool } = require('../config/db');

const router = express.Router();

const LEVY_RATE = 0.02;

// GET /api/admin/stats - Admin overview stats
router.get('/stats', async (req, res) => {
  try {
    const pool = await getPool();
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();
    const curQuarter = Math.ceil(curMonth / 3);
    const qStartMonth = (curQuarter - 1) * 3 + 1;

    // Date filters
    const filterYear = req.query.year ? parseInt(req.query.year) : null;
    const filterMonth = req.query.month ? parseInt(req.query.month) : null;
    const filterQuarter = req.query.quarter ? parseInt(req.query.quarter) : null;

    // Default year to current year if month or quarter specified without year
    const effectiveYear = filterYear || ((filterMonth || filterQuarter) ? curYear : null);
    let dateWhere = '';
    if (effectiveYear && filterMonth) {
      dateWhere = ` AND e.PeriodYear = ${effectiveYear} AND e.PeriodMonth = ${filterMonth}`;
    } else if (effectiveYear && filterQuarter) {
      const qsm = (filterQuarter - 1) * 3 + 1;
      dateWhere = ` AND e.PeriodYear = ${effectiveYear} AND e.PeriodMonth BETWEEN ${qsm} AND ${qsm + 2}`;
    } else if (effectiveYear) {
      dateWhere = ` AND e.PeriodYear = ${effectiveYear}`;
    }

    // 1. Aggregate financial stats
    const statsResult = await pool.request().query(`
      SELECT
        COUNT(e.Id) AS TotalEpvs,
        SUM(ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * ${LEVY_RATE}, 0)) AS TotalBilled,
        SUM(ISNULL(e.ReconciledAmount, 0)) AS TotalPaid,
        SUM(ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * ${LEVY_RATE}, 0) - ISNULL(e.ReconciledAmount, 0)) AS TotalOutstanding,
        SUM(CASE WHEN e.IsReconciled = 1 THEN 1 ELSE 0 END) AS ReconciledCount,
        SUM(CASE WHEN (e.IsReconciled = 0 OR e.IsReconciled IS NULL) AND (ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * ${LEVY_RATE}, 0) - ISNULL(e.ReconciledAmount, 0)) > 0 THEN 1 ELSE 0 END) AS NeedReconCount,
        SUM(CASE WHEN e.ReconciledAmount IS NOT NULL AND e.ReconciledAmount > 0 AND (e.IsReconciled = 0 OR e.IsReconciled IS NULL) THEN 1 ELSE 0 END) AS PartialReconCount,
        SUM(CASE WHEN e.IsVerified = 1 THEN 1 ELSE 0 END) AS VerifiedCount,
        SUM(ISNULL(e.LevyAmount, 0)) AS TotalEggLevy,
        SUM(ISNULL(e.PulpSoldToTrade, 0) * 1.7 * ${LEVY_RATE}) AS TotalPulpLevy
      FROM EggProductionVerifications e
      WHERE e.EPVType = 'Client' AND e.Status = 'Completed'${dateWhere}
    `);

    // 2. Monthly breakdown for charts
    const monthlyResult = await pool.request().query(`
      SELECT
        e.PeriodMonth, e.PeriodYear,
        COUNT(e.Id) AS EpvCount,
        SUM(ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * ${LEVY_RATE}, 0)) AS TotalBilled,
        SUM(ISNULL(e.ReconciledAmount, 0)) AS TotalPaid,
        SUM(ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * ${LEVY_RATE}, 0) - ISNULL(e.ReconciledAmount, 0)) AS Outstanding,
        SUM(CASE WHEN e.IsReconciled = 1 THEN 1 ELSE 0 END) AS ReconciledCount,
        SUM(CASE WHEN (e.IsReconciled = 0 OR e.IsReconciled IS NULL) AND (ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * ${LEVY_RATE}, 0) - ISNULL(e.ReconciledAmount, 0)) > 0 THEN 1 ELSE 0 END) AS NeedReconCount
      FROM EggProductionVerifications e
      WHERE e.EPVType = 'Client' AND e.Status = 'Completed'${dateWhere}
      GROUP BY e.PeriodMonth, e.PeriodYear
      ORDER BY e.PeriodYear DESC, e.PeriodMonth DESC
    `);

    // 3. Outstanding by province
    const byProvResult = await pool.request().query(`
      SELECT
        c.FacilityProvince,
        COUNT(e.Id) AS EpvCount,
        SUM(ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * ${LEVY_RATE}, 0)) AS TotalBilled,
        SUM(ISNULL(e.ReconciledAmount, 0)) AS TotalPaid,
        SUM(ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * ${LEVY_RATE}, 0) - ISNULL(e.ReconciledAmount, 0)) AS Outstanding
      FROM EggProductionVerifications e
      JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
      WHERE e.EPVType = 'Client' AND e.Status = 'Completed'${dateWhere}
      GROUP BY c.FacilityProvince
      ORDER BY Outstanding DESC
    `);

    res.json({
      stats: statsResult.recordset[0],
      monthly: monthlyResult.recordset,
      byProvince: byProvResult.recordset,
      quarter: { quarter: curQuarter, year: curYear },
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// GET /api/admin/reconciliation - EPVs needing reconciliation
router.get('/reconciliation', async (req, res) => {
  const { province, month, year, status, search, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const pool = await getPool();

    let where = "WHERE e.EPVType = 'Client' AND e.Status = 'Completed'";
    const countReq = pool.request();
    const dataReq = pool.request();

    // Status filter
    if (status === 'outstanding') {
      where += " AND (e.IsReconciled = 0 OR e.IsReconciled IS NULL) AND (ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * 0.02, 0) - ISNULL(e.ReconciledAmount, 0)) > 0";
    } else if (status === 'partial') {
      where += " AND (e.IsReconciled = 0 OR e.IsReconciled IS NULL) AND e.ReconciledAmount IS NOT NULL AND e.ReconciledAmount > 0";
    } else if (status === 'reconciled') {
      where += " AND e.IsReconciled = 1";
    }

    // Province filter
    if (province) {
      where += " AND c.FacilityProvince = @province";
      countReq.input('province', sql.NVarChar, province);
      dataReq.input('province', sql.NVarChar, province);
    }

    // Month/year filter
    if (month) {
      where += " AND e.PeriodMonth = @month";
      countReq.input('month', sql.Int, parseInt(month));
      dataReq.input('month', sql.Int, parseInt(month));
    }
    if (year) {
      where += " AND e.PeriodYear = @year";
      countReq.input('year', sql.Int, parseInt(year));
      dataReq.input('year', sql.Int, parseInt(year));
    }

    // Search filter
    if (search) {
      where += " AND (c.BusinessName LIKE @search OR e.ReferenceNumber LIKE @search)";
      countReq.input('search', sql.NVarChar, `%${search}%`);
      dataReq.input('search', sql.NVarChar, `%${search}%`);
    }

    // Count
    const countResult = await countReq.query(`
      SELECT COUNT(*) AS total
      FROM EggProductionVerifications e
      JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
      ${where}
    `);
    const total = countResult.recordset[0].total;

    // Data
    dataReq.input('offset', sql.Int, offset);
    dataReq.input('limit', sql.Int, parseInt(limit));
    const result = await dataReq.query(`
      SELECT
        e.Id, e.ClientRecordId, e.ReferenceNumber, e.PeriodMonth, e.PeriodYear,
        e.LevyAmount, e.PulpSoldToTrade, e.SoldToTrade,
        ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * 0.02, 0) AS TotalBilled,
        ISNULL(e.ReconciledAmount, 0) AS ReconciledAmount,
        ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * 0.02, 0) - ISNULL(e.ReconciledAmount, 0) AS Outstanding,
        e.IsReconciled, e.ReconciledBy, e.ReconciledAt,
        e.IsVerified, e.POPFilePath, e.CompletedAt,
        c.BusinessName, c.FacilityProvince, c.Town
      FROM EggProductionVerifications e
      JOIN ConsolidatedMasterAbattoirDatabase c ON e.ClientRecordId = c.Id
      ${where}
      ORDER BY
        CASE WHEN (e.IsReconciled = 0 OR e.IsReconciled IS NULL)
          AND (ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * 0.02, 0) - ISNULL(e.ReconciledAmount, 0)) > 0
        THEN 0 ELSE 1 END,
        (ISNULL(e.LevyAmount, 0) + ISNULL(e.PulpSoldToTrade * 1.7 * 0.02, 0) - ISNULL(e.ReconciledAmount, 0)) DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    res.json({
      data: result.recordset,
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    console.error('Reconciliation list error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// PUT /api/admin/reconcile-batch - Batch reconcile with amounts
router.put('/reconcile-batch', async (req, res) => {
  const { items, reconciledBy, userRole } = req.body;
  // items = [{ id, amount }]

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'No items provided.' });
  }

  try {
    const pool = await getPool();
    let updated = 0;

    for (const item of items) {
      const { id, amount } = item;
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) continue;

      // Get current EPV
      const existing = await pool.request()
        .input('id', sql.Int, parseInt(id))
        .query(`
          SELECT Id, ClientRecordId, ReferenceNumber,
            ISNULL(LevyAmount, 0) + ISNULL(PulpSoldToTrade * 1.7 * 0.02, 0) AS TotalBilled,
            ISNULL(ReconciledAmount, 0) AS OldReconAmount,
            IsReconciled
          FROM EggProductionVerifications WHERE Id = @id
        `);

      if (existing.recordset.length === 0) continue;
      const epv = existing.recordset[0];

      const fullyReconciled = parsedAmount >= epv.TotalBilled;

      await pool.request()
        .input('id', sql.Int, parseInt(id))
        .input('amount', sql.Decimal(18, 2), parsedAmount)
        .input('reconciled', sql.Bit, fullyReconciled ? 1 : 0)
        .input('reconciledBy', sql.NVarChar, reconciledBy || 'Unknown')
        .query(`
          UPDATE EggProductionVerifications
          SET ReconciledAmount = @amount,
              IsReconciled = @reconciled,
              ReconciledBy = @reconciledBy,
              ReconciledAt = GETDATE()
          WHERE Id = @id
        `);

      // Audit
      if (epv.ClientRecordId) {
        await pool.request()
          .input('recordId', sql.Int, epv.ClientRecordId)
          .input('fieldName', sql.NVarChar, 'Reconciled Amount')
          .input('oldValue', sql.NVarChar, `R ${epv.OldReconAmount}`)
          .input('newValue', sql.NVarChar, `R ${parsedAmount}`)
          .input('changedBy', sql.NVarChar, reconciledBy || 'Unknown')
          .input('userRole', sql.NVarChar, userRole || null)
          .query(`INSERT INTO ClientAuditLog (RecordId, FieldName, OldValue, NewValue, ChangedBy, UserRole)
              VALUES (@recordId, @fieldName, @oldValue, @newValue, @changedBy, @userRole)`);
      }

      updated++;
    }

    res.json({ message: `${updated} EPV(s) reconciled successfully.`, updated });
  } catch (err) {
    console.error('Batch reconcile error:', err);
    res.status(500).json({ message: 'Failed to batch reconcile.' });
  }
});

module.exports = router;
