import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import './PageStyles.css';
import './Dashboard.css';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PIE_COLORS = ['#0E7C7B', '#4f46e5', '#d97706', '#dc2626', '#16a34a', '#7c3aed', '#059669', '#e11d48', '#0284c7', '#9ca3af'];

function Dashboard() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [epvData, setEpvData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kpiTargets, setKpiTargets] = useState({ collection_rate: 80, approvals_actioned: 90, facilities_visited: 100 });
  const [showKpiModal, setShowKpiModal] = useState(false);
  const [editTargets, setEditTargets] = useState({});
  const [kpiSaving, setKpiSaving] = useState(false);
  const [filterYear, setFilterYear] = useState('');
  const [filterQuarter, setFilterQuarter] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const isSuperAdmin = user.role === 'Super Admin';

  useEffect(() => {
    setLoading(true);
    const params = {};
    if (filterYear) params.year = filterYear;
    if (filterQuarter) params.quarter = filterQuarter;
    if (filterMonth) params.month = filterMonth;

    Promise.all([
      axios.get('/api/dashboard/stats'),
      axios.get('/api/dashboard/epv-overview', { params }),
      axios.get('/api/dashboard/kpi-targets'),
    ])
      .then(([statsRes, epvRes, kpiRes]) => {
        setStats(statsRes.data);
        setEpvData(epvRes.data);
        const t = kpiRes.data.targets || {};
        setKpiTargets({
          collection_rate: t.collection_rate?.value ?? 80,
          approvals_actioned: t.approvals_actioned?.value ?? 90,
          facilities_visited: t.facilities_visited?.value ?? 100,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterYear, filterQuarter, filterMonth]);

  const openKpiModal = () => {
    setEditTargets({ ...kpiTargets });
    setShowKpiModal(true);
  };

  const saveKpiTargets = async () => {
    setKpiSaving(true);
    try {
      await axios.put('/api/dashboard/kpi-targets', {
        targets: editTargets,
        updatedBy: `${user.firstName} ${user.lastName} (${user.email})`,
        userRole: user.role,
      });
      setKpiTargets({ ...editTargets });
      setShowKpiModal(false);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to save targets.');
    } finally {
      setKpiSaving(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString();
  };

  const formatR = (v) => `R ${(+v || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatNum = (v) => (+v || 0).toLocaleString('en-ZA');
  const formatRShort = (v) => {
    const n = +v || 0;
    if (n >= 1000000) return `R ${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `R ${(n / 1000).toFixed(0)}K`;
    return `R ${n.toFixed(0)}`;
  };

  const getPriorityClass = (p) => {
    switch (p) {
      case 'Urgent': return 'dash-priority-urgent';
      case 'High': return 'dash-priority-high';
      case 'Medium': return 'dash-priority-medium';
      default: return 'dash-priority-low';
    }
  };

  const getStatusClass = (s) => {
    switch (s) {
      case 'Open': return 'dash-status-open';
      case 'In Progress': return 'dash-status-progress';
      case 'Resolved': return 'dash-status-resolved';
      case 'Closed': return 'dash-status-closed';
      default: return '';
    }
  };

  // EPV chart data
  const chartData = useMemo(() => {
    if (!epvData?.monthly) return [];
    return [...epvData.monthly]
      .sort((a, b) => a.PeriodYear - b.PeriodYear || a.PeriodMonth - b.PeriodMonth)
      .map(m => ({
        name: `${MONTH_NAMES[m.PeriodMonth - 1].slice(0, 3)} ${m.PeriodYear}`,
        'Total Billed': +(m.TotalBilled || 0).toFixed(2),
        'Total Paid': +(m.TotalPaid || 0).toFixed(2),
        'Egg Levy': +(m.EggLevy || 0).toFixed(2),
        'Pulp Levy': +(m.PulpLevy || 0).toFixed(2),
        'EPV Count': m.EpvCount || 0,
        'Rejections': m.Rejections || 0,
        paidPct: m.TotalBilled > 0 ? +((m.TotalPaid / m.TotalBilled) * 100).toFixed(0) : 0,
      }));
  }, [epvData]);

  // Province pie data
  const provincePieData = useMemo(() => {
    if (!epvData?.facilitiesByProvince) return [];
    return epvData.facilitiesByProvince.map(p => ({
      name: p.FacilityProvince,
      value: p.FacilityCount,
    }));
  }, [epvData]);

  if (loading) {
    return (
      <div className="page-container dash-page">
        <div className="page-card"><p style={{ color: '#888', textAlign: 'center', padding: 30 }}>Loading dashboard...</p></div>
      </div>
    );
  }

  const s = epvData?.stats || {};
  const q = epvData?.quarter || {};
  const monthly = epvData?.monthly || [];
  const totalFacilities = epvData?.totalFacilities || 0;

  // KPI computations
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();
  const prevMonths = monthly.filter(m => m.PeriodYear < curYear || (m.PeriodYear === curYear && m.PeriodMonth < curMonth));
  const curMonthData = monthly.find(m => m.PeriodYear === curYear && m.PeriodMonth === curMonth);

  const prevBilled = prevMonths.reduce((a, m) => a + (m.TotalBilled || 0), 0);
  const prevPaid = prevMonths.reduce((a, m) => a + (m.TotalPaid || 0), 0);
  const prevPct = prevBilled > 0 ? +((prevPaid / prevBilled) * 100).toFixed(1) : 0;
  const sortedPrev = [...prevMonths].sort((a, b) => a.PeriodYear - b.PeriodYear || a.PeriodMonth - b.PeriodMonth);
  const prevMonthNames = sortedPrev.length > 0
    ? `${MONTH_NAMES[sortedPrev[0].PeriodMonth - 1].slice(0, 3)} ${sortedPrev[0].PeriodYear} – ${MONTH_NAMES[sortedPrev[sortedPrev.length - 1].PeriodMonth - 1].slice(0, 3)} ${sortedPrev[sortedPrev.length - 1].PeriodYear}`
    : 'Prior Months';

  const curBilled = curMonthData ? (curMonthData.TotalBilled || 0) : 0;
  const curPaid = curMonthData ? (curMonthData.TotalPaid || 0) : 0;
  const curPct = curBilled > 0 ? +((curPaid / curBilled) * 100).toFixed(1) : 0;
  const curMonthName = MONTH_NAMES[curMonth - 1];

  const approvalPct = s.TotalEpvs > 0 ? +((s.VerifiedCount / s.TotalEpvs) * 100).toFixed(1) : 0;
  const visitedDone = totalFacilities - (epvData?.needVisitCount || 0);
  const visitedPct = totalFacilities > 0 ? +((visitedDone / totalFacilities) * 100).toFixed(1) : 0;

  const paidPct = s.TotalBilled > 0 ? ((s.TotalPaid / s.TotalBilled) * 100).toFixed(1) : 0;

  const ct = kpiTargets.collection_rate;
  const at = kpiTargets.approvals_actioned;
  const ft = kpiTargets.facilities_visited;

  const kpis = [
    { label: `Collection — ${prevMonthNames || 'Prior Months'}`, value: prevPct, target: ct, suffix: '%', detail: `${formatR(prevPaid)} of ${formatR(prevBilled)}`, color: prevPct >= ct ? '#16a34a' : prevPct >= ct * 0.75 ? '#d97706' : '#dc2626' },
    { label: `Collection — ${curMonthName} (Current)`, value: curPct, target: ct, suffix: '%', detail: `${formatR(curPaid)} of ${formatR(curBilled)}`, color: curPct >= ct ? '#16a34a' : curPct >= ct * 0.75 ? '#d97706' : '#dc2626' },
    { label: 'Approvals Actioned', value: approvalPct, target: at, suffix: '%', detail: `${formatNum(s.VerifiedCount)} of ${formatNum(s.TotalEpvs)} EPVs`, color: approvalPct >= at ? '#16a34a' : approvalPct >= at * 0.78 ? '#d97706' : '#dc2626' },
    { label: 'Facilities Visited', value: visitedPct, target: ft, suffix: '%', detail: `${formatNum(visitedDone)} of ${formatNum(totalFacilities)} (Q${filterQuarter || q.quarter})`, color: visitedPct >= ft ? '#16a34a' : visitedPct >= ft * 0.75 ? '#d97706' : '#dc2626' },
  ];

  return (
    <div className="page-container dash-page">
      {/* Welcome */}
      <div className="page-card dash-welcome">
        <div className="dash-welcome-text">
          <h2>Welcome back, {user.firstName}!</h2>
          <p>Here's a holistic overview of your EPVS system.</p>
        </div>
        <span className="dash-role-badge">{user.role}</span>
      </div>

      {/* Date Filters */}
      <div className="dash-date-filters">
        <label className="dash-filter-label">Filter:</label>
        <select className="dash-filter-select" value={filterYear} onChange={e => { setFilterYear(e.target.value); if (!e.target.value) { setFilterQuarter(''); setFilterMonth(''); } }}>
          <option value="">All Years</option>
          <option value="2025">2025</option>
          <option value="2026">2026</option>
        </select>
        <select className="dash-filter-select" value={filterQuarter} onChange={e => { setFilterQuarter(e.target.value); if (e.target.value) setFilterMonth(''); }}>
          <option value="">All Quarters</option>
          <option value="1">Q1 (Jan–Mar)</option>
          <option value="2">Q2 (Apr–Jun)</option>
          <option value="3">Q3 (Jul–Sep)</option>
          <option value="4">Q4 (Oct–Dec)</option>
        </select>
        <select className="dash-filter-select" value={filterMonth} onChange={e => { setFilterMonth(e.target.value); if (e.target.value) setFilterQuarter(''); }}>
          <option value="">All Months</option>
          {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        {(filterYear || filterQuarter || filterMonth) && (
          <button className="dash-filter-clear" onClick={() => { setFilterYear(''); setFilterQuarter(''); setFilterMonth(''); }}>Clear Filters</button>
        )}
      </div>

      {/* Top-level Stats */}
      {stats && (
        <>
          <div className="dash-stats-grid">
            <div className="dash-stat-card" onClick={() => navigate('/settings')}>
              <div className="dash-stat-icon dash-stat-users">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div className="dash-stat-content">
                <span className="dash-stat-number">{stats.users.total}</span>
                <span className="dash-stat-label">Total Users</span>
                <span className="dash-stat-sub">{stats.users.active} active</span>
              </div>
            </div>

            <div className="dash-stat-card" onClick={() => navigate('/clients')}>
              <div className="dash-stat-icon dash-stat-clients">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              </div>
              <div className="dash-stat-content">
                <span className="dash-stat-number">{stats.clients.total}</span>
                <span className="dash-stat-label">Total Clients</span>
                <span className="dash-stat-sub">{stats.clients.verified} verified</span>
              </div>
            </div>

            <div className="dash-stat-card" onClick={() => navigate('/epv')}>
              <div className="dash-stat-icon dash-stat-epv">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              </div>
              <div className="dash-stat-content">
                <span className="dash-stat-number">{stats.epv.total}</span>
                <span className="dash-stat-label">EPV Forms</span>
                <span className="dash-stat-sub">{stats.epv.completed} completed</span>
              </div>
            </div>

            <div className="dash-stat-card" onClick={() => navigate('/support')}>
              <div className="dash-stat-icon dash-stat-tickets">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div className="dash-stat-content">
                <span className="dash-stat-number">{stats.tickets.total}</span>
                <span className="dash-stat-label">Support Tickets</span>
                <span className="dash-stat-sub">{stats.tickets.open} open</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* KPI Gauges */}
      {epvData && (
        <>
          {/* KPI Module */}
          <div className="dash-module">
            <div className="dash-module-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>EPV Performance KPIs</span>
              {isSuperAdmin && (
                <button className="dash-kpi-edit-btn" onClick={openKpiModal}>Edit Targets</button>
              )}
            </div>
            <div className="dash-kpi-grid">
              {kpis.map(kpi => {
                const barPct = Math.min(100, kpi.value);
                const meetsTarget = kpi.value >= kpi.target;
                return (
                  <div key={kpi.label} className="dash-kpi-card">
                    <div className="dash-kpi-header">
                      <span className="dash-kpi-label">{kpi.label}</span>
                      <span className={`dash-kpi-status ${meetsTarget ? 'dash-kpi-met' : 'dash-kpi-not-met'}`}>
                        {meetsTarget ? 'ON TARGET' : 'BELOW TARGET'}
                      </span>
                    </div>
                    <div className="dash-kpi-value-row">
                      <span className="dash-kpi-value" style={{ color: kpi.color }}>{kpi.value}{kpi.suffix}</span>
                      <span className="dash-kpi-target">Target: &ge;{kpi.target}{kpi.suffix}</span>
                    </div>
                    <div className="dash-kpi-bar">
                      <div className="dash-kpi-bar-fill" style={{ width: `${barPct}%`, background: kpi.color }}></div>
                      <div className="dash-kpi-bar-target" style={{ left: `${Math.min(100, kpi.target)}%` }}></div>
                    </div>
                    <div className="dash-kpi-detail">{kpi.detail}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Items + Financial Summary Module */}
          <div className="dash-module">
            <div className="dash-module-title">Action Items & Financial Summary</div>
            <div className="dash-epv-top-grid">
              <div className="dash-action-summary">
                <div className="dash-action-card dash-action-urgent" onClick={() => navigate('/inspectors')}>
                  <span className="dash-action-count dash-action-count-urgent">{epvData.pendingApprovalsCount}</span>
                  <div className="dash-action-detail">
                    <div className="dash-action-title">Pending Approvals</div>
                    <div className="dash-action-desc">EPVs awaiting verification</div>
                  </div>
                </div>
                <div className="dash-action-card dash-action-warning" onClick={() => navigate('/inspectors')}>
                  <span className="dash-action-count dash-action-count-warning">{epvData.inspToCompleteCount}</span>
                  <div className="dash-action-detail">
                    <div className="dash-action-title">Inspector EPVs to Complete</div>
                    <div className="dash-action-desc">Rejected — awaiting inspector form</div>
                  </div>
                </div>
                <div className="dash-action-card dash-action-info" onClick={() => navigate('/inspectors')}>
                  <span className="dash-action-count dash-action-count-info">{epvData.needVisitCount}</span>
                  <div className="dash-action-detail">
                    <div className="dash-action-title">Facilities Need Visit</div>
                    <div className="dash-action-desc">Q{filterQuarter || q.quarter} — no inspection yet</div>
                  </div>
                </div>
                <div className="dash-action-card dash-action-danger" onClick={() => navigate('/inspectors')}>
                  <span className="dash-action-count dash-action-count-danger">{epvData.notCompletedCount}</span>
                  <div className="dash-action-detail">
                    <div className="dash-action-title">Not Completed EPVs</div>
                    <div className="dash-action-desc">{filterYear || '2025'}{!filterYear && `–${curYear}`} — facilities missing EPVs</div>
                  </div>
                </div>
              </div>

              <div className="dash-finance-summary">
                <div className="dash-finance-row-item">
                  <span className="dash-finance-label">Total Billed</span>
                  <span className="dash-finance-value dash-finance-billed">{formatR(s.TotalBilled)}</span>
                </div>
                <div className="dash-finance-row-item">
                  <span className="dash-finance-label">Total Paid</span>
                  <span className="dash-finance-value dash-finance-paid">{formatR(s.TotalPaid)}</span>
                </div>
                <div className="dash-finance-row-item">
                  <span className="dash-finance-label">Outstanding</span>
                  <span className="dash-finance-value dash-finance-outstanding">{formatR(s.TotalOutstanding)}</span>
                </div>
                <div className="dash-finance-divider"></div>
                <div className="dash-finance-row-item">
                  <span className="dash-finance-label">Egg Levy</span>
                  <span className="dash-finance-value">{formatNum(s.TotalEggDozens)} doz — {formatR(s.TotalEggLevy)}</span>
                </div>
                <div className="dash-finance-row-item">
                  <span className="dash-finance-label">Pulp Levy</span>
                  <span className="dash-finance-value">{formatNum(s.TotalPulpDozens)} doz — {formatR(s.TotalPulpLevy)}</span>
                </div>
                <div className="dash-finance-divider"></div>
                <div className="dash-finance-row-item">
                  <span className="dash-finance-label">Collection Rate</span>
                  <span className="dash-finance-value" style={{ color: paidPct >= 80 ? '#16a34a' : '#d97706', fontWeight: 800 }}>{paidPct}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* EPV Stats Module */}
          <div className="dash-module">
            <div className="dash-module-title">EPV Statistics</div>
            <div className="dash-epv-stats-row">
              <div className="dash-epv-stat">
                <span className="dash-epv-stat-num" style={{ color: '#0E7C7B' }}>{formatNum(totalFacilities)}</span>
                <span className="dash-epv-stat-label">Facilities</span>
              </div>
              <div className="dash-epv-stat">
                <span className="dash-epv-stat-num" style={{ color: '#4f46e5' }}>{formatNum(s.TotalEpvs)}</span>
                <span className="dash-epv-stat-label">Completed EPVs</span>
              </div>
              <div className="dash-epv-stat">
                <span className="dash-epv-stat-num" style={{ color: '#16a34a' }}>{formatNum(s.VerifiedCount)}</span>
                <span className="dash-epv-stat-label">Verified</span>
              </div>
              <div className="dash-epv-stat">
                <span className="dash-epv-stat-num" style={{ color: '#dc2626' }}>{formatNum(s.TotalRejections)}</span>
                <span className="dash-epv-stat-label">Rejections</span>
              </div>
              <div className="dash-epv-stat">
                <span className="dash-epv-stat-num" style={{ color: '#d97706' }}>{formatNum(s.ManualInspections)}</span>
                <span className="dash-epv-stat-label">Inspections Done</span>
              </div>
              <div className="dash-epv-stat">
                <span className="dash-epv-stat-num" style={{ color: '#7c3aed' }}>{epvData.outstandingCount}</span>
                <span className="dash-epv-stat-label">Outstanding</span>
              </div>
            </div>
          </div>

          {/* Financial Charts Module */}
          <div className="dash-module">
            <div className="dash-module-title">Financial Charts</div>
            <div className="dash-charts-grid">
              <div className="dash-chart-card">
                <h3>Total Billed vs Paid — Month Over Month</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={formatRShort} />
                    <Tooltip formatter={(v) => formatR(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Total Billed" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Total Paid" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="dash-chart-card">
                <h3>Egg Levy vs Pulp Levy — Month Over Month</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#0E7C7B' }} tickFormatter={formatRShort} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#d97706' }} tickFormatter={formatRShort} />
                    <Tooltip formatter={(v) => formatR(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line yAxisId="left" type="monotone" dataKey="Egg Levy" stroke="#0E7C7B" strokeWidth={3} dot={{ r: 5 }} />
                    <Line yAxisId="right" type="monotone" dataKey="Pulp Levy" stroke="#d97706" strokeWidth={3} dot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Province Charts Module */}
          <div className="dash-module">
            <div className="dash-module-title">Province Overview</div>
            <div className="dash-charts-grid">
              <div className="dash-chart-card">
                <h3>Facilities by Province</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={provincePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, value }) => `${name}: ${value}`}>
                      {provincePieData.map((entry, idx) => (
                        <Cell key={entry.name} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="dash-chart-card">
                <h3>Rejections by Province</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={(epvData.rejectionsByProvince || []).map(p => ({ name: p.FacilityProvince, Rejections: p.Rejections }))} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} angle={-30} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="Rejections" fill="#dc2626" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Secondary Stats Row */}
      {stats && (
        <>
          <div className="dash-module">
            <div className="dash-module-title">System Overview</div>
            <div className="dash-secondary-grid">
              <div className="dash-breakdown-card">
                <h3>Users by Role</h3>
                <div className="dash-role-list">
                  {stats.users.byRole.map(r => (
                    <div key={r.Role} className="dash-role-item">
                      <span className="dash-role-name">{r.Role}</span>
                      <span className="dash-role-count">{r.count}</span>
                      <div className="dash-role-bar">
                        <div className="dash-role-bar-fill" style={{ width: `${(r.count / stats.users.total) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="dash-breakdown-card">
                <h3>Client Verification</h3>
                <div className="dash-donut-stats">
                  <div className="dash-donut-item">
                    <span className="dash-donut-number dash-color-green">{stats.clients.verified}</span>
                    <span className="dash-donut-label">Verified</span>
                  </div>
                  <div className="dash-donut-divider" />
                  <div className="dash-donut-item">
                    <span className="dash-donut-number dash-color-amber">{stats.clients.unverified}</span>
                    <span className="dash-donut-label">Unverified</span>
                  </div>
                  <div className="dash-donut-divider" />
                  <div className="dash-donut-item">
                    <span className="dash-donut-number dash-color-blue">{stats.pendingInvites}</span>
                    <span className="dash-donut-label">Pending Invites</span>
                  </div>
                </div>
              </div>

              <div className="dash-breakdown-card">
                <h3>Ticket Overview</h3>
                <div className="dash-ticket-breakdown">
                  <div className="dash-ticket-stat">
                    <span className="dash-ticket-num dash-color-blue">{stats.tickets.open}</span>
                    <span>Open</span>
                  </div>
                  <div className="dash-ticket-stat">
                    <span className="dash-ticket-num dash-color-amber">{stats.tickets.inProgress}</span>
                    <span>In Progress</span>
                  </div>
                  <div className="dash-ticket-stat">
                    <span className="dash-ticket-num dash-color-green">{stats.tickets.resolved}</span>
                    <span>Resolved</span>
                  </div>
                  <div className="dash-ticket-stat">
                    <span className="dash-ticket-num dash-color-gray">{stats.tickets.closed}</span>
                    <span>Closed</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Activity Module */}
          <div className="dash-module">
            <div className="dash-module-title">Recent Activity</div>
            <div className="dash-recent-grid">
              <div className="dash-recent-card">
                <div className="dash-recent-header">
                  <h3>Recent Users</h3>
                  <button className="dash-view-all" onClick={() => navigate('/settings')}>View All</button>
                </div>
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentUsers.map((u, i) => (
                      <tr key={i}>
                        <td className="dash-name">{u.FirstName} {u.LastName}</td>
                        <td>{u.Email}</td>
                        <td><span className="dash-role-pill">{u.Role}</span></td>
                        <td className="dash-date">{formatDate(u.CreatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="dash-recent-card">
                <div className="dash-recent-header">
                  <h3>Recent Tickets</h3>
                  <button className="dash-view-all" onClick={() => navigate('/support')}>View All</button>
                </div>
                {stats.recentTickets.length === 0 ? (
                  <p className="dash-empty">No tickets yet.</p>
                ) : (
                  <table className="dash-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Subject</th>
                        <th>Priority</th>
                        <th>Status</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.recentTickets.map(t => (
                        <tr key={t.Id} className="dash-clickable" onClick={() => navigate('/support')}>
                          <td className="dash-ticket-id">#{t.Id}</td>
                          <td className="dash-name">{t.Subject}</td>
                          <td><span className={`dash-priority ${getPriorityClass(t.Priority)}`}>{t.Priority}</span></td>
                          <td><span className={`dash-status ${getStatusClass(t.Status)}`}>{t.Status}</span></td>
                          <td className="dash-date">{formatDate(t.CreatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </>
      )}
      {/* KPI Target Edit Modal */}
      {showKpiModal && (
        <div className="dash-kpi-modal-overlay" onClick={() => setShowKpiModal(false)}>
          <div className="dash-kpi-modal" onClick={e => e.stopPropagation()}>
            <h3>Edit KPI Targets</h3>
            <p className="dash-kpi-modal-sub">Adjust the target percentages for each KPI metric.</p>
            <div className="dash-kpi-modal-fields">
              {[
                { key: 'collection_rate', label: 'Collection Rate (%)' },
                { key: 'approvals_actioned', label: 'Approvals Actioned (%)' },
                { key: 'facilities_visited', label: 'Facilities Visited (%)' },
              ].map(f => (
                <div key={f.key} className="dash-kpi-modal-field">
                  <label>{f.label}</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={editTargets[f.key] ?? ''}
                    onChange={e => setEditTargets(prev => ({ ...prev, [f.key]: +e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="dash-kpi-modal-actions">
              <button className="dash-kpi-modal-cancel" onClick={() => setShowKpiModal(false)} disabled={kpiSaving}>Cancel</button>
              <button className="dash-kpi-modal-save" onClick={saveKpiTargets} disabled={kpiSaving}>
                {kpiSaving ? 'Saving...' : 'Save Targets'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
