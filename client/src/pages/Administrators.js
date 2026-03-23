import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import './PageStyles.css';
import './Administrators.css';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SA_PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];

function useSortable(data, defaultKey, defaultDir = 'asc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);

  const sorted = useMemo(() => {
    if (!sortKey || !data) return data;
    return [...data].sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va == null) va = '';
      if (vb == null) vb = '';
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortIcon = ({ col }) => (
    <span className="admin-sort-icon">
      {sortKey === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
    </span>
  );

  return { sorted, toggleSort, SortIcon, sortKey, sortDir };
}

function Administrators() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const navigate = useNavigate();

  const [stats, setStats] = useState(null);
  const [reconData, setReconData] = useState({ data: [], total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Filters
  const [activeTab, setActiveTab] = useState('outstanding');
  const [filterProvince, setFilterProvince] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Reconciliation edits
  const [editAmounts, setEditAmounts] = useState({});
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [kpiTargets, setKpiTargets] = useState({ collection_rate: 80, reconciliation_rate: 90, outstanding_rate: 5, verification_rate: 90 });

  const formatR = (v) => `R ${(+v || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatNum = (v) => (+v || 0).toLocaleString('en-ZA');
  const formatRShort = (v) => {
    const n = +v || 0;
    if (n >= 1000000) return `R ${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `R ${(n / 1000).toFixed(0)}K`;
    return `R ${n.toFixed(0)}`;
  };

  const userLabel = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown';

  const fetchStats = useCallback(async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/admin/stats');
      setStats(res.data);
    } catch (err) {
      setError('Failed to load admin stats.');
    }
  }, []);

  const fetchReconData = useCallback(async () => {
    try {
      const params = { page, limit: 50 };
      if (activeTab === 'outstanding') params.status = 'outstanding';
      else if (activeTab === 'partial') params.status = 'partial';
      else if (activeTab === 'reconciled') params.status = 'reconciled';
      if (filterProvince) params.province = filterProvince;
      if (filterMonth) params.month = filterMonth;
      if (filterYear) params.year = filterYear;
      if (search) params.search = search;

      const res = await axios.get('http://localhost:5000/api/admin/reconciliation', { params });
      setReconData(res.data);
    } catch (err) {
      console.error('Failed to load reconciliation data:', err);
    }
  }, [activeTab, filterProvince, filterMonth, filterYear, search, page]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchReconData()]);
    setLoading(false);
  }, [fetchStats, fetchReconData]);

  useEffect(() => {
    refreshAll();
    axios.get('http://localhost:5000/api/dashboard/kpi-targets')
      .then(res => {
        const t = res.data.targets || {};
        setKpiTargets({
          collection_rate: t.collection_rate?.value ?? 80,
          reconciliation_rate: t.reconciliation_rate?.value ?? 90,
          outstanding_rate: t.outstanding_rate?.value ?? 5,
          verification_rate: t.verification_rate?.value ?? 90,
        });
      })
      .catch(() => {});
  }, [refreshAll]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [activeTab, filterProvince, filterMonth, filterYear, search]);

  // Clear success message
  useEffect(() => {
    if (successMsg) { const t = setTimeout(() => setSuccessMsg(''), 3000); return () => clearTimeout(t); }
  }, [successMsg]);

  // Reconcile single EPV
  const reconcileSingle = async (epv) => {
    const amount = editAmounts[epv.Id];
    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid reconciliation amount.');
      return;
    }
    setError('');
    try {
      await axios.put('http://localhost:5000/api/admin/reconcile-batch', {
        items: [{ id: epv.Id, amount: parseFloat(amount) }],
        reconciledBy: userLabel,
        userRole: user.role,
      });
      setSuccessMsg(`EPV ${epv.ReferenceNumber || epv.Id} reconciled.`);
      setEditAmounts(prev => { const n = { ...prev }; delete n[epv.Id]; return n; });
      setSelectedIds(prev => { const n = new Set(prev); n.delete(epv.Id); return n; });
      refreshAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Reconciliation failed.');
    }
  };

  // Mark as fully paid
  const reconcileFull = async (epv) => {
    setError('');
    try {
      await axios.put('http://localhost:5000/api/admin/reconcile-batch', {
        items: [{ id: epv.Id, amount: epv.TotalBilled }],
        reconciledBy: userLabel,
        userRole: user.role,
      });
      setSuccessMsg(`EPV ${epv.ReferenceNumber || epv.Id} marked as fully paid.`);
      refreshAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Reconciliation failed.');
    }
  };

  // Batch reconcile selected (full amount)
  const batchReconcile = async () => {
    if (selectedIds.size === 0) return;
    setBatchProcessing(true);
    setError('');
    try {
      const items = reconData.data
        .filter(e => selectedIds.has(e.Id))
        .map(e => ({
          id: e.Id,
          amount: editAmounts[e.Id] ? parseFloat(editAmounts[e.Id]) : e.TotalBilled,
        }));
      await axios.put('http://localhost:5000/api/admin/reconcile-batch', {
        items,
        reconciledBy: userLabel,
        userRole: user.role,
      });
      setSuccessMsg(`${items.length} EPV(s) reconciled successfully.`);
      setSelectedIds(new Set());
      setEditAmounts({});
      refreshAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Batch reconciliation failed.');
    } finally {
      setBatchProcessing(false);
    }
  };

  // Toggle select
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === reconData.data.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(reconData.data.map(e => e.Id)));
    }
  };

  const s = stats?.stats || {};
  const monthly = stats?.monthly || [];
  const byProvince = stats?.byProvince || [];

  // Chart data
  const chartData = useMemo(() =>
    [...monthly]
      .sort((a, b) => a.PeriodYear - b.PeriodYear || a.PeriodMonth - b.PeriodMonth)
      .map(m => ({
        name: `${MONTH_NAMES[m.PeriodMonth - 1].slice(0, 3)} ${m.PeriodYear}`,
        'Total Billed': +(m.TotalBilled || 0).toFixed(2),
        'Reconciled': +(m.TotalPaid || 0).toFixed(2),
        'Outstanding': +(m.Outstanding || 0).toFixed(2),
      })),
    [monthly]
  );

  const outstandingByProvChart = useMemo(() =>
    byProvince.map(p => ({
      name: p.FacilityProvince || 'Unknown',
      'Outstanding': +(p.Outstanding || 0).toFixed(2),
      'Paid': +(p.TotalPaid || 0).toFixed(2),
    })),
    [byProvince]
  );

  // KPI computations
  const reconPct = s.TotalEPVs > 0 ? +((s.ReconciledCount / s.TotalEPVs) * 100).toFixed(1) : 0;
  const collectionPct = s.TotalBilled > 0 ? +((s.TotalPaid / s.TotalBilled) * 100).toFixed(1) : 0;
  const outstandingPct = s.TotalBilled > 0 ? +((s.TotalOutstanding / s.TotalBilled) * 100).toFixed(1) : 0;

  const reconSort = useSortable(reconData.data, 'Outstanding', 'desc');

  // Tab counts
  const outstandingCount = s.NeedReconCount || 0;
  const partialCount = s.PartialReconCount || 0;
  const reconciledCount = s.ReconciledCount || 0;

  // Available years for filter
  const years = [...new Set(monthly.map(m => m.PeriodYear))].sort((a, b) => b - a);

  if (loading && !stats) {
    return (
      <div className="page-container admin-page">
        <div className="page-card"><p className="admin-loading">Loading admin dashboard...</p></div>
      </div>
    );
  }

  const crT = kpiTargets.collection_rate;
  const rrT = kpiTargets.reconciliation_rate;
  const orT = kpiTargets.outstanding_rate;
  const vrT = kpiTargets.verification_rate;
  const verificationVal = s.TotalEPVs > 0 ? +((s.VerifiedCount / s.TotalEPVs) * 100).toFixed(1) : 0;
  const kpis = [
    { label: 'Collection Rate', value: collectionPct, target: crT, suffix: '%', detail: `${formatR(s.TotalPaid)} of ${formatR(s.TotalBilled)}`, color: collectionPct >= crT ? '#16a34a' : collectionPct >= crT * 0.75 ? '#d97706' : '#dc2626' },
    { label: 'Reconciliation Rate', value: reconPct, target: rrT, suffix: '%', detail: `${formatNum(s.ReconciledCount)} of ${formatNum(s.TotalEPVs)} EPVs reconciled`, color: reconPct >= rrT ? '#16a34a' : reconPct >= rrT * 0.78 ? '#d97706' : '#dc2626' },
    { label: 'Outstanding Rate', value: outstandingPct, target: orT, suffix: '%', detail: `${formatR(s.TotalOutstanding)} outstanding`, invert: true, color: outstandingPct <= orT ? '#16a34a' : outstandingPct <= orT * 3 ? '#d97706' : '#dc2626' },
    { label: 'Verification Rate', value: verificationVal, target: vrT, suffix: '%', detail: `${formatNum(s.VerifiedCount)} of ${formatNum(s.TotalEPVs)} verified`, color: verificationVal >= vrT ? '#16a34a' : verificationVal >= vrT * 0.78 ? '#d97706' : '#dc2626' },
  ];

  return (
    <div className="page-container admin-page">
      {/* Header */}
      <div className="page-card admin-header-card">
        <div className="admin-header">
          <div>
            <h2>Administrators Dashboard</h2>
            <p className="admin-subtitle">Reconciliation & Financial Management — {user.firstName} {user.lastName} ({user.role})</p>
          </div>
        </div>
      </div>

      {/* KPI Gauges */}
      <div className="admin-module">
        <div className="admin-module-title">Performance KPIs</div>
        <div className="admin-kpi-grid">
          {kpis.map(kpi => {
            const barPct = kpi.invert ? Math.min(100, (kpi.value / Math.max(kpi.target * 4, 1)) * 100) : Math.min(100, kpi.value);
            const meetsTarget = kpi.invert ? kpi.value <= kpi.target : kpi.value >= kpi.target;
            return (
              <div key={kpi.label} className="admin-kpi-card">
                <div className="admin-kpi-header">
                  <span className="admin-kpi-label">{kpi.label}</span>
                  <span className={`admin-kpi-status ${meetsTarget ? 'admin-kpi-met' : 'admin-kpi-not-met'}`}>
                    {meetsTarget ? 'ON TARGET' : 'BELOW TARGET'}
                  </span>
                </div>
                <div className="admin-kpi-value-row">
                  <span className="admin-kpi-value" style={{ color: kpi.color }}>{kpi.value}{kpi.suffix}</span>
                  <span className="admin-kpi-target">Target: {kpi.invert ? '≤' : '≥'}{kpi.target}{kpi.suffix}</span>
                </div>
                <div className="admin-kpi-bar">
                  <div className="admin-kpi-bar-fill" style={{ width: `${barPct}%`, background: kpi.color }}></div>
                  {!kpi.invert && <div className="admin-kpi-bar-target" style={{ left: `${Math.min(100, kpi.target)}%` }}></div>}
                </div>
                <div className="admin-kpi-detail">{kpi.detail}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action Items + Financial Summary */}
      <div className="admin-module">
        <div className="admin-module-title">Action Items & Financial Summary</div>
        <div className="admin-top-grid">
        <div className="admin-action-summary">
          <div className="admin-action-card admin-action-card-urgent" onClick={() => setActiveTab('outstanding')}>
            <span className="admin-action-count admin-action-count-urgent">{formatNum(outstandingCount)}</span>
            <div className="admin-action-detail">
              <div className="admin-action-title">Needs Reconciliation</div>
              <div className="admin-action-desc">EPVs with outstanding amounts</div>
            </div>
          </div>
          <div className="admin-action-card admin-action-card-warning" onClick={() => setActiveTab('partial')}>
            <span className="admin-action-count admin-action-count-warning">{formatNum(partialCount)}</span>
            <div className="admin-action-detail">
              <div className="admin-action-title">Partially Reconciled</div>
              <div className="admin-action-desc">Payment received, not fully matched</div>
            </div>
          </div>
          <div className="admin-action-card admin-action-card-success" onClick={() => setActiveTab('reconciled')}>
            <span className="admin-action-count admin-action-count-success">{formatNum(reconciledCount)}</span>
            <div className="admin-action-detail">
              <div className="admin-action-title">Fully Reconciled</div>
              <div className="admin-action-desc">All payments matched</div>
            </div>
          </div>
          <div className="admin-action-card admin-action-card-info" onClick={() => setActiveTab('all')}>
            <span className="admin-action-count admin-action-count-info">{formatNum(s.TotalEPVs)}</span>
            <div className="admin-action-detail">
              <div className="admin-action-title">Total Completed EPVs</div>
              <div className="admin-action-desc">All completed facility EPVs</div>
            </div>
          </div>
        </div>

        <div className="admin-finance-summary">
          <div className="admin-finance-row-item">
            <span className="admin-finance-label">Total Billed</span>
            <span className="admin-finance-value admin-finance-billed">{formatR(s.TotalBilled)}</span>
          </div>
          <div className="admin-finance-row-item">
            <span className="admin-finance-label">Total Reconciled</span>
            <span className="admin-finance-value admin-finance-paid">{formatR(s.TotalPaid)}</span>
          </div>
          <div className="admin-finance-row-item">
            <span className="admin-finance-label">Outstanding</span>
            <span className="admin-finance-value admin-finance-outstanding">{formatR(s.TotalOutstanding)}</span>
          </div>
          <div className="admin-finance-divider"></div>
          <div className="admin-finance-row-item">
            <span className="admin-finance-label">Egg Levy Total</span>
            <span className="admin-finance-value">{formatR(s.TotalEggLevy)}</span>
          </div>
          <div className="admin-finance-row-item">
            <span className="admin-finance-label">Pulp Levy Total</span>
            <span className="admin-finance-value">{formatR(s.TotalPulpLevy)}</span>
          </div>
        </div>
      </div>
      </div>

      {/* Charts */}
      <div className="admin-module">
        <div className="admin-module-title">Financial Charts</div>
        <div className="admin-charts-grid">
          <div className="admin-chart-card">
            <h3>Billed vs Reconciled vs Outstanding — Month Over Month</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={formatRShort} />
              <Tooltip formatter={(v) => formatR(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Total Billed" fill="#4f46e5" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Reconciled" fill="#16a34a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Outstanding" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </div>
          <div className="admin-chart-card">
            <h3>Outstanding by Province</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={outstandingByProvChart} margin={{ top: 10, right: 30, left: 10, bottom: 5 }} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={formatRShort} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} width={110} />
                <Tooltip formatter={(v) => formatR(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Outstanding" fill="#dc2626" radius={[0, 4, 4, 0]} />
                <Bar dataKey="Paid" fill="#16a34a" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Messages */}
      {successMsg && <div className="admin-success">{successMsg}</div>}
      {error && <div className="admin-error">{error}</div>}

      {/* Reconciliation Management */}
      <div className="admin-module">
        <div className="admin-module-title">Reconciliation Management</div>

        {/* Tabs */}
        <div className="admin-tabs">
          <button className={`admin-tab ${activeTab === 'outstanding' ? 'admin-tab-active' : ''}`} onClick={() => setActiveTab('outstanding')}>
            Needs Reconciliation {outstandingCount > 0 && <span className="admin-tab-badge">{outstandingCount > 999 ? `${(outstandingCount/1000).toFixed(1)}K` : outstandingCount}</span>}
          </button>
          <button className={`admin-tab ${activeTab === 'partial' ? 'admin-tab-active' : ''}`} onClick={() => setActiveTab('partial')}>
            Partially Reconciled {partialCount > 0 && <span className="admin-tab-badge">{partialCount}</span>}
          </button>
          <button className={`admin-tab ${activeTab === 'reconciled' ? 'admin-tab-active' : ''}`} onClick={() => setActiveTab('reconciled')}>
            Reconciled {reconciledCount > 0 && <span className="admin-tab-badge admin-tab-badge-green">{reconciledCount > 999 ? `${(reconciledCount/1000).toFixed(1)}K` : reconciledCount}</span>}
          </button>
          <button className={`admin-tab ${activeTab === 'all' ? 'admin-tab-active' : ''}`} onClick={() => setActiveTab('all')}>
            All EPVs
          </button>
        </div>

        {/* Filters */}
        <div className="admin-tab-content">
        <div className="admin-filters-row">
          <input className="admin-filter-input" placeholder="Search by name, client ID, or ref..." value={search} onChange={e => setSearch(e.target.value)} />
          <select className="admin-filter-select" value={filterProvince} onChange={e => setFilterProvince(e.target.value)}>
            <option value="">All Provinces</option>
            {SA_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className="admin-filter-select" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>
            <option value="">All Months</option>
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select className="admin-filter-select" value={filterYear} onChange={e => setFilterYear(e.target.value)}>
            <option value="">All Years</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {activeTab === 'outstanding' && selectedIds.size > 0 && (
            <button className="admin-batch-btn" onClick={batchReconcile} disabled={batchProcessing}>
              {batchProcessing ? 'Processing...' : `Reconcile Selected (${selectedIds.size})`}
            </button>
          )}
        </div>

        {/* Table */}
        <div className="admin-table-wrap">
          <table className="admin-table admin-sortable">
            <thead>
              <tr>
                {activeTab === 'outstanding' && (
                  <th style={{ width: 40 }}>
                    <input type="checkbox" checked={reconData.data.length > 0 && selectedIds.size === reconData.data.length} onChange={toggleSelectAll} />
                  </th>
                )}
                <th className="admin-sortable-th" onClick={() => reconSort.toggleSort('BusinessName')}>
                  Facility <reconSort.SortIcon col="BusinessName" />
                </th>
                <th className="admin-sortable-th" onClick={() => reconSort.toggleSort('ClientID')}>
                  Client ID <reconSort.SortIcon col="ClientID" />
                </th>
                <th className="admin-sortable-th" onClick={() => reconSort.toggleSort('FacilityProvince')}>
                  Province <reconSort.SortIcon col="FacilityProvince" />
                </th>
                <th className="admin-sortable-th" onClick={() => reconSort.toggleSort('PeriodMonth')}>
                  Period <reconSort.SortIcon col="PeriodMonth" />
                </th>
                <th>Ref #</th>
                <th className="admin-sortable-th admin-th-right" onClick={() => reconSort.toggleSort('TotalBilled')}>
                  Total Billed <reconSort.SortIcon col="TotalBilled" />
                </th>
                <th className="admin-sortable-th admin-th-right" onClick={() => reconSort.toggleSort('ReconciledAmount')}>
                  Reconciled <reconSort.SortIcon col="ReconciledAmount" />
                </th>
                <th className="admin-sortable-th admin-th-right" onClick={() => reconSort.toggleSort('Outstanding')}>
                  Outstanding <reconSort.SortIcon col="Outstanding" />
                </th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {reconSort.sorted.length === 0 ? (
                <tr><td colSpan={activeTab === 'outstanding' ? 11 : 10} className="admin-empty">No EPVs found matching filters.</td></tr>
              ) : (
                reconSort.sorted.map(epv => {
                  const outstanding = epv.Outstanding || 0;
                  const isFullyRecon = epv.IsReconciled;
                  return (
                    <tr key={epv.Id} className={selectedIds.has(epv.Id) ? 'admin-row-selected' : ''}>
                      {activeTab === 'outstanding' && (
                        <td><input type="checkbox" checked={selectedIds.has(epv.Id)} onChange={() => toggleSelect(epv.Id)} /></td>
                      )}
                      <td className="admin-name">
                        <span className="admin-facility-link" onClick={() => navigate(`/company?companyId=${epv.ClientRecordId}`)} title="View facility overview">
                          {epv.BusinessName}
                        </span>
                      </td>
                      <td className="admin-client-id">{epv.ClientID}</td>
                      <td>{epv.FacilityProvince}</td>
                      <td>{MONTH_NAMES[(epv.PeriodMonth || 1) - 1]?.slice(0, 3)} {epv.PeriodYear}</td>
                      <td className="admin-ref">{epv.ReferenceNumber || '-'}</td>
                      <td className="admin-amount">{formatR(epv.TotalBilled)}</td>
                      <td className="admin-amount admin-amount-paid">{formatR(epv.ReconciledAmount)}</td>
                      <td className={`admin-amount ${outstanding > 0 ? 'admin-amount-outstanding' : 'admin-amount-paid'}`}>
                        {formatR(outstanding)}
                      </td>
                      <td>
                        {isFullyRecon ? (
                          <span className="admin-status-badge admin-status-reconciled">Reconciled</span>
                        ) : epv.ReconciledAmount > 0 ? (
                          <span className="admin-status-badge admin-status-partial">Partial</span>
                        ) : (
                          <span className="admin-status-badge admin-status-outstanding">Outstanding</span>
                        )}
                      </td>
                      <td className="admin-actions-cell">
                        {!isFullyRecon && (
                          <div className="admin-action-group">
                            <input
                              type="number"
                              className="admin-recon-input"
                              placeholder="Amount"
                              value={editAmounts[epv.Id] || ''}
                              onChange={e => setEditAmounts(prev => ({ ...prev, [epv.Id]: e.target.value }))}
                              step="0.01"
                              min="0"
                            />
                            <button className="admin-recon-btn" onClick={() => reconcileSingle(epv)} title="Reconcile with entered amount">
                              Reconcile
                            </button>
                            <button className="admin-full-btn" onClick={() => reconcileFull(epv)} title="Mark as fully paid">
                              Full
                            </button>
                          </div>
                        )}
                        {isFullyRecon && (
                          <span className="admin-done-label">Done</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {reconData.totalPages > 1 && (
          <div className="admin-pagination">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            <span>Page {reconData.page} of {reconData.totalPages} ({reconData.total} total)</span>
            <button disabled={page >= reconData.totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

export default Administrators;
