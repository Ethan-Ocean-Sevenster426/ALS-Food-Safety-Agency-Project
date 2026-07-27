import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import './PageStyles.css';
import './Inspectors.css';

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
    <span className="insp-sort-icon">
      {sortKey === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
    </span>
  );

  return { sorted, toggleSort, SortIcon, sortKey, sortDir };
}

function Inspectors() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const navigate = useNavigate();
  const isInspectorRole = user.role === 'Inspector';
  const isAdmin = user.role === 'Super Admin' || user.role === 'Admin' || user.role === 'Super';
  const assignedProvince = user.inspectorProvince || null;

  const [stats, setStats] = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [inspEPVsToComplete, setInspEPVsToComplete] = useState([]);
  const [notCompleted, setNotCompleted] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [activeTab, setActiveTab] = useState('approvals');
  const [visitSearch, setVisitSearch] = useState('');
  const [owingSearch, setOwingSearch] = useState('');
  const [selectedProvince, setSelectedProvince] = useState(isInspectorRole ? assignedProvince : '');
  const [selectedInspector, setSelectedInspector] = useState('');
  const [inspectorList, setInspectorList] = useState([]);
  const [approvalSearch, setApprovalSearch] = useState('');
  const [approvalPeriod, setApprovalPeriod] = useState(0);
  const [incompletePeriod, setIncompletePeriod] = useState(0);
  const [notCompletedSearch, setNotCompletedSearch] = useState('');
  const [notCompletedMonth, setNotCompletedMonth] = useState(0);
  const [inspCreating, setInspCreating] = useState(null);
  const [kpiTargets, setKpiTargets] = useState({ collection_rate: 80, approvals_actioned: 90, facilities_visited: 100 });
  const [filterYear, setFilterYear] = useState('');
  const [filterQuarter, setFilterQuarter] = useState('');
  const [filterMonth, setFilterMonth] = useState('');

  const formatR = (v) => `R ${(+v || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatNum = (v) => (+v || 0).toLocaleString('en-ZA');
  const formatRShort = (v) => {
    const n = +v || 0;
    if (n >= 1000000) return `R ${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `R ${(n / 1000).toFixed(0)}K`;
    return `R ${n.toFixed(0)}`;
  };

  const userLabel = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown';
  const LEVY_RATE = 0.020;

  const getProvinceParam = useCallback(() => {
    // Inspectors are scoped by assigned facilities (inspectorId), not province
    if (isInspectorRole) return '';
    if (selectedProvince) return selectedProvince;
    return '';
  }, [isInspectorRole, selectedProvince]);

  const getDateParams = useCallback(() => {
    const p = {};
    if (filterYear) p.year = filterYear;
    if (filterQuarter) p.quarter = filterQuarter;
    if (filterMonth) p.month = filterMonth;
    if (isAdmin && selectedInspector) p.inspectorId = selectedInspector;
    else if (isInspectorRole && user.id) p.inspectorId = user.id;
    return p;
  }, [filterYear, filterQuarter, filterMonth, isAdmin, selectedInspector, isInspectorRole, user.id]);

  // Load inspector list for the admin filter dropdown
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const res = await axios.get('/api/auth/users', { params: { role: 'Inspector' } });
        const list = (res.data.users || [])
          .filter(u => u.Role === 'Inspector' && u.IsActive !== false)
          .map(u => ({
            Id: u.Id,
            name: `${u.FirstName || ''} ${u.LastName || ''}`.trim() || u.Email,
            province: u.InspectorProvince || '',
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setInspectorList(list);
      } catch (err) {
        // filter dropdown just stays empty
      }
    })();
  }, [isAdmin]);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...getDateParams() };
      const prov = getProvinceParam();
      if (prov) params.province = prov;
      const res = await axios.get('/api/epv/inspector/stats', { params });
      setStats(res.data);
    } catch (err) {
      setError('Failed to load inspector stats.');
    } finally {
      setLoading(false);
    }
  }, [getProvinceParam, getDateParams]);

  const fetchPendingApprovals = useCallback(async () => {
    try {
      const params = { ...getDateParams() };
      const prov = getProvinceParam();
      if (prov) params.province = prov;
      const res = await axios.get('/api/epv/inspector/pending-approvals', { params });
      setPendingApprovals(res.data.pendingApprovals || []);
      setInspEPVsToComplete(res.data.inspectorEPVsToComplete || []);
    } catch (err) {
      console.error('Failed to load pending approvals:', err);
    }
  }, [getProvinceParam, getDateParams]);

  const fetchNotCompleted = useCallback(async () => {
    try {
      const params = { ...getDateParams() };
      const prov = getProvinceParam();
      if (prov) params.province = prov;
      const res = await axios.get('/api/epv/inspector/not-completed', { params });
      setNotCompleted(res.data.notCompleted || []);
    } catch (err) {
      console.error('Failed to load not-completed:', err);
    }
  }, [getProvinceParam, getDateParams]);

  const refreshAll = useCallback(() => {
    fetchStats();
    fetchPendingApprovals();
    fetchNotCompleted();
  }, [fetchStats, fetchPendingApprovals, fetchNotCompleted]);

  useEffect(() => {
    refreshAll();
    axios.get('/api/dashboard/kpi-targets')
      .then(res => {
        const t = res.data.targets || {};
        setKpiTargets({
          collection_rate: t.collection_rate?.value ?? 80,
          approvals_actioned: t.approvals_actioned?.value ?? 90,
          facilities_visited: t.facilities_visited?.value ?? 100,
        });
      })
      .catch(() => {});
  }, [refreshAll]);

  // Approve EPV
  const approveEpv = async (epvId) => {
    setError('');
    try {
      await axios.put(`/api/epv/${epvId}/verify`, {
        verified: true,
        verifiedBy: userLabel,
        userRole: user.role,
      });
      setSuccessMsg('EPV approved successfully.');
      refreshAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to approve EPV.');
    }
  };

  // Reject EPV — create inspector EPV
  const rejectAndInspect = async (epv) => {
    if (!window.confirm('Reject this EPV? You will be redirected to complete an Inspector EPV with the correct amounts.')) return;
    if (epv.InspEPVId && epv.InspEPVToken) {
      navigate(`/epv/${epv.InspEPVToken}`);
      return;
    }
    setInspCreating(epv.Id);
    setError('');
    try {
      const res = await axios.post('/api/epv/inspector/create', {
        clientEpvId: epv.Id,
        inspectorId: user.id,
        inspectorName: userLabel,
        userRole: user.role,
      });
      setSuccessMsg('Inspector EPV created. Redirecting to form...');
      setTimeout(() => navigate(`/epv/${res.data.token}`), 500);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create Inspector EPV.');
    } finally {
      setInspCreating(null);
    }
  };

  // Clear success message after delay
  useEffect(() => {
    if (successMsg) { const t = setTimeout(() => setSuccessMsg(''), 3000); return () => clearTimeout(t); }
  }, [successMsg]);

  const s = stats?.stats || {};
  const q = stats?.quarter || {};
  const needVisit = stats?.needVisitThisQuarter || [];
  const owing = stats?.outstandingByFacility || [];
  const monthly = stats?.monthly || [];
  const rejByProv = stats?.rejectionsByProvince || [];
  const facByProv = stats?.facilitiesByProvince || [];

  // Chart data — monthly sorted chronologically
  const chartData = useMemo(() =>
    [...monthly].sort((a, b) => a.PeriodYear - b.PeriodYear || a.PeriodMonth - b.PeriodMonth)
      .map(m => ({
        name: `${MONTH_NAMES[m.PeriodMonth - 1].slice(0, 3)} ${m.PeriodYear}`,
        'Total Billed': +(m.TotalBilled || 0).toFixed(2),
        'Total Paid': +(m.TotalPaid || 0).toFixed(2),
        'Egg Levy': +(m.EggLevy || 0).toFixed(2),
        'Pulp Levy': +(m.PulpLevy || 0).toFixed(2),
        'Powder Eggs Levy': +(m.PowderLevy || 0).toFixed(2),
        'Egg Dozens': m.EggDozens || 0,
        'Pulp Dozens': m.PulpDozens || 0,
        'Rejections': m.Rejections || 0,
        paidPct: m.TotalBilled > 0 ? +((m.TotalPaid / m.TotalBilled) * 100).toFixed(0) : 0,
      })),
    [monthly]
  );


  // Filtered & sorted lists
  const filteredNeedVisit = needVisit.filter(f =>
    (f.BusinessName || '').toLowerCase().includes(visitSearch.toLowerCase()) ||
    (f.Town || '').toLowerCase().includes(visitSearch.toLowerCase())
  );
  const filteredOwing = owing.filter(f =>
    (f.BusinessName || '').toLowerCase().includes(owingSearch.toLowerCase())
  );

  // Approvals: group by period and filter
  const approvalsByPeriod = {};
  pendingApprovals.forEach(a => {
    const key = (a.PeriodYear || 0) * 100 + (a.PeriodMonth || 0);
    if (!approvalsByPeriod[key]) approvalsByPeriod[key] = { year: a.PeriodYear, month: a.PeriodMonth, count: 0 };
    approvalsByPeriod[key].count++;
  });
  const approvalPeriods = Object.values(approvalsByPeriod).sort((a, b) => a.year - b.year || a.month - b.month);

  const filteredApprovals = pendingApprovals.filter(a => {
    if (approvalPeriod > 0) {
      const aKey = (a.PeriodYear || 0) * 100 + (a.PeriodMonth || 0);
      if (aKey !== approvalPeriod) return false;
    }
    return (a.BusinessName || '').toLowerCase().includes(approvalSearch.toLowerCase()) ||
      (a.ReferenceNumber || '').toLowerCase().includes(approvalSearch.toLowerCase());
  });

  // Incomplete: group by period
  const incompleteByPeriod = {};
  inspEPVsToComplete.forEach(e => {
    const key = (e.PeriodYear || 0) * 100 + (e.PeriodMonth || 0);
    if (!incompleteByPeriod[key]) incompleteByPeriod[key] = { year: e.PeriodYear, month: e.PeriodMonth, count: 0 };
    incompleteByPeriod[key].count++;
  });
  const incompletePeriods = Object.values(incompleteByPeriod).sort((a, b) => a.year - b.year || a.month - b.month);

  const filteredIncomplete = inspEPVsToComplete.filter(e => {
    if (incompletePeriod > 0) {
      const eKey = (e.PeriodYear || 0) * 100 + (e.PeriodMonth || 0);
      if (eKey !== incompletePeriod) return false;
    }
    return true;
  });

  // Not-completed: group by year+month key, filter by search and optional period filter
  // notCompletedMonth stores a "YYYYMM" key like 202501, or 0 for all
  const filteredNotCompleted = notCompleted.filter(f => {
    if (notCompletedMonth > 0) {
      const fKey = f.PeriodYear * 100 + f.PeriodMonth;
      if (fKey !== notCompletedMonth) return false;
    }
    const search = notCompletedSearch.toLowerCase();
    if (!search) return true;
    return (f.BusinessName || '').toLowerCase().includes(search) ||
      (f.FacilityProvince || '').toLowerCase().includes(search);
  });
  const notCompletedByPeriod = {};
  notCompleted.forEach(f => {
    const key = f.PeriodYear * 100 + f.PeriodMonth;
    if (!notCompletedByPeriod[key]) notCompletedByPeriod[key] = { year: f.PeriodYear, month: f.PeriodMonth, count: 0 };
    notCompletedByPeriod[key].count++;
  });
  const ncPeriods = Object.values(notCompletedByPeriod).sort((a, b) => a.year - b.year || a.month - b.month);

  const visitSort = useSortable(filteredNeedVisit, 'BusinessName', 'asc');
  const owingSort = useSortable(filteredOwing, 'TotalOwing', 'desc');
  const approvalSort = useSortable(filteredApprovals, 'CompletedAt', 'desc');
  const notCompletedSort = useSortable(filteredNotCompleted, 'PeriodMonth', 'asc');

  const getEpvAmount = (epv) => {
    const egg = +epv.LevyAmount || 0;
    const pulp = (+epv.PulpSoldToTrade || 0) * 1.7 * LEVY_RATE;
    return egg + pulp;
  };

  const totalFacilities = facByProv.reduce((a, b) => a + b.FacilityCount, 0);
  const paidPct = s.TotalBilled > 0 ? ((s.TotalPaid / s.TotalBilled) * 100).toFixed(1) : 0;

  const pendingCount = pendingApprovals.length;
  const completionCount = inspEPVsToComplete.length;

  if (loading) {
    return (
      <div className="page-container inspectors-page">
        <div className="page-card"><p className="insp-loading">Loading inspector dashboard...</p></div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="page-container inspectors-page">
        <div className="page-card"><p className="insp-error">{error}</p></div>
      </div>
    );
  }


  return (
    <div className="page-container inspectors-page">
      {/* Header */}
      <div className="page-card insp-header-card">
        <div className="insp-header">
          <div>
            <h2>Inspector Dashboard</h2>
            <p className="insp-subtitle">
              {isInspectorRole ? `Inspector: ${user.firstName} ${user.lastName}` : `${user.role}: ${user.firstName} ${user.lastName}`}
              {isInspectorRole && <> — <strong>Assigned facilities</strong></>}
            </p>
          </div>
          {isAdmin && (
            <div className="insp-province-filter">
              <label>Inspector Filter:</label>
              <select value={selectedInspector} onChange={e => setSelectedInspector(e.target.value)}>
                <option value="">All Inspectors</option>
                <option value="unassigned">Unassigned</option>
                {inspectorList.map(i => (
                  <option key={i.Id} value={String(i.Id)}>{i.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Date Filters */}
      <div className="insp-date-filters">
        <label className="insp-filter-label">Filter:</label>
        <select className="insp-filter-select" value={filterYear} onChange={e => { setFilterYear(e.target.value); if (!e.target.value) { setFilterQuarter(''); setFilterMonth(''); } }}>
          <option value="">All Years</option>
          <option value="2025">2025</option>
          <option value="2026">2026</option>
        </select>
        <select className="insp-filter-select" value={filterQuarter} onChange={e => { setFilterQuarter(e.target.value); if (e.target.value) setFilterMonth(''); }}>
          <option value="">All Quarters</option>
          <option value="1">Q1 (Jan–Mar)</option>
          <option value="2">Q2 (Apr–Jun)</option>
          <option value="3">Q3 (Jul–Sep)</option>
          <option value="4">Q4 (Oct–Dec)</option>
        </select>
        <select className="insp-filter-select" value={filterMonth} onChange={e => { setFilterMonth(e.target.value); if (e.target.value) setFilterQuarter(''); }}>
          <option value="">All Months</option>
          {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        {(filterYear || filterQuarter || filterMonth) && (
          <button className="insp-filter-clear" onClick={() => { setFilterYear(''); setFilterQuarter(''); setFilterMonth(''); }}>Clear Filters</button>
        )}
      </div>

      {/* KPI Gauges */}
      {(() => {
        const now = new Date();
        const curMonth = now.getMonth() + 1;
        const curYear = now.getFullYear();

        // Split monthly data into previous months and current month
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
        const visitedTotal = totalFacilities;
        const visitedDone = totalFacilities - needVisit.length;
        const visitedPct = visitedTotal > 0 ? +((visitedDone / visitedTotal) * 100).toFixed(1) : 0;

        const ct = kpiTargets.collection_rate;
        const at = kpiTargets.approvals_actioned;
        const ft = kpiTargets.facilities_visited;
        const kpis = [
          { label: `Collection — ${prevMonthNames || 'Prior Months'}`, value: prevPct, target: ct, suffix: '%', detail: `${formatR(prevPaid)} of ${formatR(prevBilled)}`, color: prevPct >= ct ? '#16a34a' : prevPct >= ct * 0.75 ? '#d97706' : '#dc2626' },
          { label: `Collection — ${curMonthName} (Current)`, value: curPct, target: ct, suffix: '%', detail: `${formatR(curPaid)} of ${formatR(curBilled)}`, color: curPct >= ct ? '#16a34a' : curPct >= ct * 0.75 ? '#d97706' : '#dc2626' },
          { label: 'Approvals Actioned', value: approvalPct, target: at, suffix: '%', detail: `${formatNum(s.VerifiedCount)} of ${formatNum(s.TotalEpvs)} EPVs`, color: approvalPct >= at ? '#16a34a' : approvalPct >= at * 0.78 ? '#d97706' : '#dc2626' },
          { label: 'Facilities Visited', value: visitedPct, target: ft, suffix: '%', detail: `${formatNum(visitedDone)} of ${formatNum(visitedTotal)} (Q${q.quarter})`, color: visitedPct >= ft ? '#16a34a' : visitedPct >= ft * 0.75 ? '#d97706' : '#dc2626' },
        ];

        return (
          <div className="insp-module">
            <div className="insp-module-title">Performance KPIs</div>
          <div className="insp-kpi-grid">
            {kpis.map(kpi => {
              const barPct = kpi.invert ? Math.min(100, (kpi.value / Math.max(kpi.target * 4, 1)) * 100) : Math.min(100, kpi.value);
              const meetsTarget = kpi.invert ? kpi.value <= kpi.target : kpi.value >= kpi.target;
              return (
                <div key={kpi.label} className="insp-kpi-card">
                  <div className="insp-kpi-header">
                    <span className="insp-kpi-label">{kpi.label}</span>
                    <span className={`insp-kpi-status ${meetsTarget ? 'insp-kpi-met' : 'insp-kpi-not-met'}`}>
                      {meetsTarget ? 'ON TARGET' : 'BELOW TARGET'}
                    </span>
                  </div>
                  <div className="insp-kpi-value-row">
                    <span className="insp-kpi-value" style={{ color: kpi.color }}>{kpi.value}{kpi.suffix}</span>
                    <span className="insp-kpi-target">Target: {kpi.invert ? '≤' : '≥'}{kpi.target}{kpi.suffix}</span>
                  </div>
                  <div className="insp-kpi-bar">
                    <div className="insp-kpi-bar-fill" style={{ width: `${barPct}%`, background: kpi.color }}></div>
                    {!kpi.invert && <div className="insp-kpi-bar-target" style={{ left: `${Math.min(100, kpi.target)}%` }}></div>}
                  </div>
                  <div className="insp-kpi-detail">{kpi.detail}</div>
                </div>
              );
            })}
          </div>
          </div>
        );
      })()}

      {/* Action Items + Financial Summary */}
      <div className="insp-module">
        <div className="insp-module-title">Action Items & Statistics</div>
      <div className="insp-top-grid">
        {/* Action Items */}
        <div className="insp-action-summary">
          <div className="insp-action-card insp-action-card-urgent" onClick={() => setActiveTab('approvals')}>
            <span className="insp-action-count insp-action-count-urgent">{pendingCount}</span>
            <div className="insp-action-detail">
              <div className="insp-action-title">EPVs Needing Approval</div>
              <div className="insp-action-desc">Approve or reject</div>
            </div>
          </div>
          <div className="insp-action-card insp-action-card-warning" onClick={() => setActiveTab('incomplete')}>
            <span className="insp-action-count insp-action-count-warning">{completionCount}</span>
            <div className="insp-action-detail">
              <div className="insp-action-title">Inspector EPVs to Complete</div>
              <div className="insp-action-desc">Complete your inspector form</div>
            </div>
          </div>
          <div className="insp-action-card insp-action-card-warning" onClick={() => setActiveTab('visits')}>
            <span className="insp-action-count insp-action-count-warning">{needVisit.length}</span>
            <div className="insp-action-detail">
              <div className="insp-action-title">Facilities Need Visit</div>
              <div className="insp-action-desc">Q{q.quarter} — no inspection yet</div>
            </div>
          </div>
          <div className="insp-action-card insp-action-card-info" onClick={() => setActiveTab('owing')}>
            <span className="insp-action-count insp-action-count-info">{owing.length}</span>
            <div className="insp-action-detail">
              <div className="insp-action-title">Outstanding Payments</div>
              <div className="insp-action-desc">{formatR(s.TotalOutstanding)}</div>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="insp-stats-grid">
          <div className="insp-stat-card insp-stat-primary">
            <span className="insp-stat-number">{formatNum(totalFacilities)}</span>
            <span className="insp-stat-label">Facilities</span>
          </div>
          <div className="insp-stat-card insp-stat-info">
            <span className="insp-stat-number">{formatNum(s.TotalEpvs)}</span>
            <span className="insp-stat-label">EPVs</span>
          </div>
          <div className="insp-stat-card insp-stat-danger">
            <span className="insp-stat-number">{formatNum(s.TotalRejections)}</span>
            <span className="insp-stat-label">Rejections</span>
          </div>
          <div className="insp-stat-card insp-stat-success">
            <span className="insp-stat-number">{formatNum(s.ManualInspections)}</span>
            <span className="insp-stat-label">Inspections Done</span>
          </div>
        </div>
      </div>
      </div>

      {/* Financial Row */}
      <div className="insp-module">
        <div className="insp-module-title">Financial Summary</div>
      <div className="insp-finance-grid">
        <div className="insp-finance-card">
          <div className="insp-finance-row">
            <span className="insp-finance-label">Total Billed</span>
            <span className="insp-finance-value insp-finance-billed">{formatR(s.TotalBilled)}</span>
          </div>
          <div className="insp-finance-row">
            <span className="insp-finance-label">Total Paid</span>
            <span className="insp-finance-value insp-finance-paid">{formatR(s.TotalPaid)}</span>
          </div>
          <div className="insp-finance-row">
            <span className="insp-finance-label">Outstanding</span>
            <span className="insp-finance-value insp-finance-outstanding">{formatR(s.TotalOutstanding)}</span>
          </div>
        </div>
        <div className="insp-finance-card">
          <div className="insp-finance-row">
            <span className="insp-finance-label">Egg Levy</span>
            <span className="insp-finance-value">{formatNum(s.TotalEggDozens)} doz — {formatR(s.TotalEggLevy)}</span>
          </div>
          <div className="insp-finance-row">
            <span className="insp-finance-label">Pulp Levy</span>
            <span className="insp-finance-value">{formatNum(s.TotalPulpDozens)} doz — {formatR(s.TotalPulpLevy)}</span>
          </div>
          <div className="insp-finance-row">
            <span className="insp-finance-label">Powder Eggs Levy</span>
            <span className="insp-finance-value">{formatNum(s.TotalPowderDozens)} doz — {formatR(s.TotalPowderLevy)}</span>
          </div>
        </div>
      </div>
      </div>

      {/* Charts */}
      <div className="insp-module">
        <div className="insp-module-title">Financial Charts</div>
      <div className="insp-charts-grid">
        <div className="insp-chart-card">
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
        <div className="insp-chart-card">
          <h3>Egg Levy vs Pulp Levy vs Powder Eggs — Month Over Month</h3>
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
              <Line yAxisId="right" type="monotone" dataKey="Powder Eggs Levy" stroke="#7c3aed" strokeWidth={3} dot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      </div>


      {/* Messages */}
      {successMsg && <div className="insp-success">{successMsg}</div>}
      {error && <div className="insp-error">{error}</div>}

      {/* Tabs + Tab Content */}
      <div className="insp-module">
        <div className="insp-module-title">EPV Management</div>
      <div className="insp-tabs">
        <button className={`insp-tab ${activeTab === 'approvals' ? 'insp-tab-active' : ''}`} onClick={() => setActiveTab('approvals')}>
          Pending Approvals {pendingCount > 0 && <span className="insp-tab-badge">{pendingCount}</span>}
        </button>
        <button className={`insp-tab ${activeTab === 'incomplete' ? 'insp-tab-active' : ''}`} onClick={() => setActiveTab('incomplete')}>
          EPVs to Complete {completionCount > 0 && <span className="insp-tab-badge">{completionCount}</span>}
        </button>
        <button className={`insp-tab ${activeTab === 'notcompleted' ? 'insp-tab-active' : ''}`} onClick={() => setActiveTab('notcompleted')}>
          Not Completed {notCompleted.length > 0 && <span className="insp-tab-badge">{notCompleted.length}</span>}
        </button>
        <button className={`insp-tab ${activeTab === 'visits' ? 'insp-tab-active' : ''}`} onClick={() => setActiveTab('visits')}>
          Need Visit {needVisit.length > 0 && <span className="insp-tab-badge">{needVisit.length}</span>}
        </button>
        <button className={`insp-tab ${activeTab === 'owing' ? 'insp-tab-active' : ''}`} onClick={() => setActiveTab('owing')}>
          Outstanding {owing.length > 0 && <span className="insp-tab-badge">{owing.length}</span>}
        </button>
        <button className={`insp-tab ${activeTab === 'overview' ? 'insp-tab-active' : ''}`} onClick={() => setActiveTab('overview')}>Monthly Breakdown</button>
        {isAdmin && (
          <button className={`insp-tab ${activeTab === 'provinces' ? 'insp-tab-active' : ''}`} onClick={() => setActiveTab('provinces')}>By Province</button>
        )}
      </div>

      {/* Tab Content */}
      <div className="page-card insp-tab-content">
        {activeTab === 'approvals' && (
          <>
            <div className="insp-tab-header">
              <h3>Pending Approvals — Facility EPVs Awaiting Verification ({filteredApprovals.length})</h3>
              <input className="insp-tab-search" placeholder="Search by name, client ID, or ref..." value={approvalSearch} onChange={e => setApprovalSearch(e.target.value)} />
            </div>
            <p className="insp-tab-desc">
              These facility EPVs have been completed but not yet approved or rejected by an inspector. Click column headers to sort.
            </p>
            {approvalPeriods.length > 1 && (
              <div className="insp-nc-month-badges">
                {approvalPeriods.map(p => {
                  const key = p.year * 100 + p.month;
                  return (
                    <button key={key} className={`insp-nc-month-badge ${approvalPeriod === key ? 'insp-nc-month-active' : ''}`} onClick={() => setApprovalPeriod(approvalPeriod === key ? 0 : key)}>
                      <span className="insp-nc-month-name">{MONTH_NAMES[p.month - 1].slice(0, 3)} {p.year !== new Date().getFullYear() ? `'${String(p.year).slice(2)}` : ''}</span>
                      <span className="insp-nc-month-count insp-nc-month-count-pending">{p.count}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {approvalSort.sorted.length === 0 ? (
              <p className="insp-all-done">No EPVs pending approval!</p>
            ) : (
              <div className="insp-approval-table-wrap">
                <table className="insp-table insp-sortable">
                  <thead>
                    <tr>
                      <th onClick={() => approvalSort.toggleSort('ReferenceNumber')} className="insp-sortable-th">Ref #<approvalSort.SortIcon col="ReferenceNumber" /></th>
                      <th onClick={() => approvalSort.toggleSort('BusinessName')} className="insp-sortable-th">Business Name<approvalSort.SortIcon col="BusinessName" /></th>
                      <th onClick={() => approvalSort.toggleSort('FacilityProvince')} className="insp-sortable-th">Province<approvalSort.SortIcon col="FacilityProvince" /></th>
                      <th onClick={() => approvalSort.toggleSort('AssignedInspector')} className="insp-sortable-th">Inspector<approvalSort.SortIcon col="AssignedInspector" /></th>
                      <th onClick={() => approvalSort.toggleSort('PeriodMonth')} className="insp-sortable-th">Period<approvalSort.SortIcon col="PeriodMonth" /></th>
                      <th>Status</th>
                      <th onClick={() => approvalSort.toggleSort('CompletedAt')} className="insp-sortable-th">Completed<approvalSort.SortIcon col="CompletedAt" /></th>
                      <th>Facility EPV</th>
                      <th>Egg Dozens</th>
                      <th>Pulp Dozens</th>
                      <th>Powder Dozens</th>
                      <th>Amount</th>
                      <th>Verified</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvalSort.sorted.slice(0, 200).map(epv => {
                      const amount = getEpvAmount(epv);
                      return (
                        <tr key={epv.Id}>
                          <td className="insp-epv-ref">{epv.ReferenceNumber || '—'}</td>
                          <td><strong>{epv.BusinessName}</strong></td>
                          <td>{epv.FacilityProvince}</td>
                          <td>{epv.AssignedInspector || 'Unassigned'}</td>
                          <td>{MONTH_NAMES[(epv.PeriodMonth || 1) - 1]} {epv.PeriodYear}</td>
                          <td><span className="insp-pct-badge insp-pct-good">Completed</span></td>
                          <td>{epv.CompletedAt ? new Date(epv.CompletedAt).toLocaleDateString('en-ZA') : '—'}</td>
                          <td onClick={e => e.stopPropagation()}>
                            <button className="insp-go-btn" onClick={() => navigate(`/epv/${epv.Token}`)}>
                              {isAdmin ? 'View / Edit' : 'View'}
                            </button>
                          </td>
                          <td>{formatNum(epv.SoldToTrade)} doz</td>
                          <td>{formatNum(epv.PulpSoldToTrade)} doz</td>
                          <td>{formatNum(Math.round((+epv.PowderSoldToTrade || 0) * 7))} doz</td>
                          <td><strong>{formatR(amount)}</strong></td>
                          <td onClick={e => e.stopPropagation()}>
                            <div className="insp-verify-actions">
                              <button className="insp-approve-btn" onClick={() => approveEpv(epv.Id)} title="Approve — amounts are correct">
                                Approve
                              </button>
                              <button
                                className="insp-reject-btn"
                                onClick={() => rejectAndInspect(epv)}
                                disabled={inspCreating === epv.Id}
                                title="Reject — complete Inspector EPV with correct amounts"
                              >
                                {inspCreating === epv.Id ? 'Creating...' : 'Reject'}
                              </button>
                            </div>
                          </td>
                          <td>
                            <button className="insp-go-btn" onClick={() => navigate(`/company?companyId=${epv.ClientRecordId}`)}>Open Company</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {approvalSort.sorted.length > 200 && <p className="insp-more">Showing 200 of {approvalSort.sorted.length} — use search to narrow down.</p>}
          </>
        )}

        {activeTab === 'incomplete' && (
          <>
            <div className="insp-tab-header">
              <h3>Inspector EPVs to Complete ({filteredIncomplete.length})</h3>
            </div>
            <p className="insp-tab-desc">
              These facility EPVs were <strong>rejected</strong> and an Inspector EPV was created. Complete the Inspector EPV form with the correct amounts.
            </p>
            {incompletePeriods.length > 1 && (
              <div className="insp-nc-month-badges">
                {incompletePeriods.map(p => {
                  const key = p.year * 100 + p.month;
                  return (
                    <button key={key} className={`insp-nc-month-badge ${incompletePeriod === key ? 'insp-nc-month-active' : ''}`} onClick={() => setIncompletePeriod(incompletePeriod === key ? 0 : key)}>
                      <span className="insp-nc-month-name">{MONTH_NAMES[p.month - 1].slice(0, 3)} {p.year !== new Date().getFullYear() ? `'${String(p.year).slice(2)}` : ''}</span>
                      <span className="insp-nc-month-count insp-nc-month-count-pending">{p.count}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {filteredIncomplete.length === 0 ? (
              <p className="insp-all-done">No inspector EPVs to complete!</p>
            ) : (
              <div className="insp-approval-table-wrap">
                <table className="insp-table">
                  <thead>
                    <tr>
                      <th>Facility EPV Ref</th>
                      <th>Inspector EPV Ref</th>
                      <th>Business Name</th>
                      <th>Province</th>
                      <th>Period</th>
                      <th>Facility Egg Dozens</th>
                      <th>Facility Pulp Dozens</th>
                      <th>Facility Powder Dozens</th>
                      <th>Facility Amount</th>
                      <th>Inspector EPV</th>
                      <th>Company</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIncomplete.map(epv => (
                      <tr key={epv.Id} className="insp-need-visit-row">
                        <td className="insp-epv-ref">{epv.ReferenceNumber || '—'}</td>
                        <td className="insp-epv-ref">{epv.InspEPVRef || '—'}</td>
                        <td><strong>{epv.BusinessName}</strong></td>
                        <td>{epv.FacilityProvince}</td>
                        <td>{MONTH_NAMES[(epv.PeriodMonth || 1) - 1]} {epv.PeriodYear}</td>
                        <td>{formatNum(epv.SoldToTrade)} doz</td>
                        <td>{formatNum(epv.PulpSoldToTrade)} doz</td>
                        <td>{formatNum(Math.round((+epv.PowderSoldToTrade || 0) * 7))} doz</td>
                        <td><strong>{formatR(getEpvAmount(epv))}</strong></td>
                        <td>
                          <button className="insp-complete-action-btn" onClick={() => navigate(`/epv/${epv.InspEPVToken}`)}>
                            Complete Inspector EPV
                          </button>
                        </td>
                        <td>
                          <button className="insp-go-btn" onClick={() => navigate(`/company?companyId=${epv.ClientRecordId}`)}>Open Company</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {activeTab === 'notcompleted' && (
          <>
            <div className="insp-tab-header">
              <h3>Facilities Not Yet Completed EPV — {filterYear || '2025'}{!filterYear && ` – ${new Date().getFullYear()}`} ({notCompleted.length})</h3>
              <div className="insp-nc-controls">
                <select className="insp-nc-month-filter" value={notCompletedMonth} onChange={e => setNotCompletedMonth(+e.target.value)}>
                  <option value={0}>All Months ({notCompleted.length})</option>
                  {ncPeriods.map(p => {
                    const key = p.year * 100 + p.month;
                    return <option key={key} value={key}>{MONTH_NAMES[p.month - 1]} {p.year} ({p.count})</option>;
                  })}
                </select>
                <input className="insp-tab-search" placeholder="Search facilities..." value={notCompletedSearch} onChange={e => setNotCompletedSearch(e.target.value)} />
              </div>
            </div>
            <p className="insp-tab-desc">
              Facilities that have not yet completed their EPV for the selected month. EPVs still in <strong>Pending</strong> status or not yet sent.
            </p>
            {/* Month summary badges */}
            <div className="insp-nc-month-badges">
              {ncPeriods.map(p => {
                const key = p.year * 100 + p.month;
                return (
                  <button
                    key={key}
                    className={`insp-nc-month-badge ${notCompletedMonth === key ? 'insp-nc-month-active' : ''} ${p.count === 0 ? 'insp-nc-month-done' : ''}`}
                    onClick={() => setNotCompletedMonth(notCompletedMonth === key ? 0 : key)}
                  >
                    <span className="insp-nc-month-name">{MONTH_NAMES[p.month - 1].slice(0, 3)} {p.year !== new Date().getFullYear() ? `'${String(p.year).slice(2)}` : ''}</span>
                    <span className={`insp-nc-month-count ${p.count > 0 ? 'insp-nc-month-count-pending' : 'insp-nc-month-count-done'}`}>{p.count}</span>
                  </button>
                );
              })}
            </div>
            {filteredNotCompleted.length === 0 ? (
              <p className="insp-all-done">All facilities have completed their EPVs{notCompletedMonth > 0 ? ` for ${MONTH_NAMES[(notCompletedMonth % 100) - 1]} ${Math.floor(notCompletedMonth / 100)}` : ''}!</p>
            ) : (
              <div className="insp-approval-table-wrap">
                <table className="insp-table insp-sortable">
                  <thead>
                    <tr>
                      <th onClick={() => notCompletedSort.toggleSort('PeriodMonth')} className="insp-sortable-th">Month<notCompletedSort.SortIcon col="PeriodMonth" /></th>
                      <th onClick={() => notCompletedSort.toggleSort('BusinessName')} className="insp-sortable-th">Business Name<notCompletedSort.SortIcon col="BusinessName" /></th>
                      <th onClick={() => notCompletedSort.toggleSort('FacilityProvince')} className="insp-sortable-th">Province<notCompletedSort.SortIcon col="FacilityProvince" /></th>
                      <th onClick={() => notCompletedSort.toggleSort('FacilityType')} className="insp-sortable-th">Type<notCompletedSort.SortIcon col="FacilityType" /></th>
                      <th onClick={() => notCompletedSort.toggleSort('AssignedInspector')} className="insp-sortable-th">Inspector<notCompletedSort.SortIcon col="AssignedInspector" /></th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notCompletedSort.sorted.slice(0, 300).map((f, idx) => (
                      <tr key={`${f.Id}-${f.PeriodMonth}-${idx}`}>
                        <td><strong>{MONTH_NAMES[f.PeriodMonth - 1].slice(0, 3)} {f.PeriodYear}</strong></td>
                        <td><strong>{f.BusinessName}</strong></td>
                        <td>{f.FacilityProvince}</td>
                        <td>{f.FacilityType || '—'}</td>
                        <td>{f.AssignedInspector || 'Unassigned'}</td>
                        <td>
                          {f.EPVId ? (
                            <span className="insp-pct-badge insp-pct-warn">Pending</span>
                          ) : (
                            <span className="insp-pct-badge insp-pct-bad">Not Sent</span>
                          )}
                        </td>
                        <td>
                          {isAdmin ? (
                            f.EPVToken ? (
                              <button className="insp-go-btn" onClick={() => navigate(`/epv/${f.EPVToken}`)}>Open EPV</button>
                            ) : (
                              <button className="insp-go-btn" onClick={() => navigate(`/company?companyId=${f.Id}`)}>Open Company</button>
                            )
                          ) : (
                            <span className="insp-awaiting-badge">Facility Action</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {filteredNotCompleted.length > 300 && <p className="insp-more">Showing 300 of {filteredNotCompleted.length} — use search or month filter to narrow down.</p>}
          </>
        )}

        {activeTab === 'overview' && (
          <>
            <h3>Monthly Breakdown</h3>
            <table className="insp-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>EPVs</th>
                  <th>Egg Dozens</th>
                  <th>Pulp Dozens</th>
                  <th>Powder Dozens</th>
                  <th>Egg Levy</th>
                  <th>Pulp Levy</th>
                  <th>Powder Levy</th>
                  <th>Total Billed</th>
                  <th>Total Paid</th>
                  <th>Paid %</th>
                  <th>Rejections</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map(m => {
                  const mp = m.TotalBilled > 0 ? ((m.TotalPaid / m.TotalBilled) * 100).toFixed(0) : 0;
                  return (
                    <tr key={`${m.PeriodMonth}-${m.PeriodYear}`}>
                      <td><strong>{MONTH_NAMES[m.PeriodMonth - 1]} {m.PeriodYear}</strong></td>
                      <td>{formatNum(m.EpvCount)}</td>
                      <td>{formatNum(m.EggDozens)}</td>
                      <td>{formatNum(m.PulpDozens)}</td>
                      <td>{formatNum(m.PowderDozens)}</td>
                      <td>{formatR(m.EggLevy)}</td>
                      <td>{formatR(m.PulpLevy)}</td>
                      <td>{formatR(m.PowderLevy)}</td>
                      <td><strong>{formatR(m.TotalBilled)}</strong></td>
                      <td className="insp-paid-cell">{formatR(m.TotalPaid)}</td>
                      <td>
                        <span className={`insp-pct-badge ${mp >= 90 ? 'insp-pct-good' : mp >= 70 ? 'insp-pct-warn' : 'insp-pct-bad'}`}>
                          {mp}%
                        </span>
                      </td>
                      <td>{m.Rejections > 0 ? <span className="insp-rejection-count">{m.Rejections}</span> : '0'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        {activeTab === 'visits' && (
          <>
            <div className="insp-tab-header">
              <h3>Facilities Needing Visit — Q{q.quarter} {q.year} ({MONTH_NAMES[q.startMonth - 1]}–{MONTH_NAMES[q.endMonth - 1]})</h3>
              <input className="insp-tab-search" placeholder="Search facilities..." value={visitSearch} onChange={e => setVisitSearch(e.target.value)} />
            </div>
            <p className="insp-tab-desc">
              These facilities have <strong>no manual inspection</strong> ticked for this quarter. Click column headers to sort.
            </p>
            {visitSort.sorted.length === 0 ? (
              <p className="insp-all-done">All facilities have been visited this quarter!</p>
            ) : (
              <table className="insp-table insp-sortable">
                <thead>
                  <tr>
                    <th onClick={() => visitSort.toggleSort('BusinessName')} className="insp-sortable-th">Business Name<visitSort.SortIcon col="BusinessName" /></th>
                    <th onClick={() => visitSort.toggleSort('Town')} className="insp-sortable-th">Town<visitSort.SortIcon col="Town" /></th>
                    <th onClick={() => visitSort.toggleSort('FacilityProvince')} className="insp-sortable-th">Province<visitSort.SortIcon col="FacilityProvince" /></th>
                    <th onClick={() => visitSort.toggleSort('FacilityType')} className="insp-sortable-th">Facility Type<visitSort.SortIcon col="FacilityType" /></th>
                    <th onClick={() => visitSort.toggleSort('AssignedInspector')} className="insp-sortable-th">Inspector<visitSort.SortIcon col="AssignedInspector" /></th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visitSort.sorted.slice(0, 200).map(f => (
                    <tr key={f.Id} className="insp-need-visit-row">
                      <td><strong>{f.BusinessName}</strong></td>
                      <td>{f.Town || '—'}</td>
                      <td>{f.FacilityProvince}</td>
                      <td>{f.FacilityType || '—'}</td>
                      <td>{f.AssignedInspector || 'Unassigned'}</td>
                      <td><button className="insp-go-btn" onClick={() => navigate(`/company?companyId=${f.Id}`)}>Open Company</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {visitSort.sorted.length > 200 && <p className="insp-more">Showing 200 of {visitSort.sorted.length} — use search to narrow down.</p>}
          </>
        )}

        {activeTab === 'owing' && (
          <>
            <div className="insp-tab-header">
              <h3>Facilities With Outstanding Amounts ({owing.length})</h3>
              <input className="insp-tab-search" placeholder="Search facilities..." value={owingSearch} onChange={e => setOwingSearch(e.target.value)} />
            </div>
            <p className="insp-tab-desc">Click column headers to sort. Default: largest outstanding first.</p>
            {owingSort.sorted.length === 0 ? (
              <p className="insp-all-done">No outstanding amounts!</p>
            ) : (
              <table className="insp-table insp-sortable">
                <thead>
                  <tr>
                    <th onClick={() => owingSort.toggleSort('BusinessName')} className="insp-sortable-th">Business Name<owingSort.SortIcon col="BusinessName" /></th>
                    <th onClick={() => owingSort.toggleSort('FacilityProvince')} className="insp-sortable-th">Province<owingSort.SortIcon col="FacilityProvince" /></th>
                    <th onClick={() => owingSort.toggleSort('AssignedInspector')} className="insp-sortable-th">Inspector<owingSort.SortIcon col="AssignedInspector" /></th>
                    <th onClick={() => owingSort.toggleSort('TotalBilled')} className="insp-sortable-th">Total Billed<owingSort.SortIcon col="TotalBilled" /></th>
                    <th onClick={() => owingSort.toggleSort('TotalPaid')} className="insp-sortable-th">Total Paid<owingSort.SortIcon col="TotalPaid" /></th>
                    <th onClick={() => owingSort.toggleSort('TotalOwing')} className="insp-sortable-th">Outstanding<owingSort.SortIcon col="TotalOwing" /></th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {owingSort.sorted.slice(0, 200).map(f => (
                    <tr key={f.ClientRecordId}>
                      <td><strong>{f.BusinessName}</strong></td>
                      <td>{f.FacilityProvince}</td>
                      <td>{f.AssignedInspector || 'Unassigned'}</td>
                      <td>{formatR(f.TotalBilled)}</td>
                      <td className="insp-paid-cell">{formatR(f.TotalPaid)}</td>
                      <td><strong className="insp-owing-amount">{formatR(f.TotalOwing)}</strong></td>
                      <td><button className="insp-go-btn" onClick={() => navigate(`/company?companyId=${f.ClientRecordId}`)}>Open Company</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {owingSort.sorted.length > 200 && <p className="insp-more">Showing 200 of {owingSort.sorted.length} — use search to narrow down.</p>}
          </>
        )}

        {activeTab === 'provinces' && isAdmin && (
          <>
            <h3>Province Overview</h3>
            <div className="insp-prov-grid">
              {facByProv.map(p => {
                const rej = rejByProv.find(r => r.FacilityProvince === p.FacilityProvince);
                const provNeedVisit = needVisit.filter(f => f.FacilityProvince === p.FacilityProvince).length;
                const provOwing = owing.filter(f => f.FacilityProvince === p.FacilityProvince);
                const provTotalOwing = provOwing.reduce((a, b) => a + (b.TotalOwing || 0), 0);
                return (
                  <div key={p.FacilityProvince} className="insp-prov-card" onClick={() => setSelectedProvince(p.FacilityProvince)} style={{ cursor: 'pointer' }}>
                    <h4>{p.FacilityProvince}</h4>
                    <div className="insp-prov-stats">
                      <div className="insp-prov-stat">
                        <span className="insp-prov-num">{p.FacilityCount}</span>
                        <span className="insp-prov-label">Facilities</span>
                      </div>
                      <div className="insp-prov-stat">
                        <span className="insp-prov-num insp-prov-danger">{rej?.Rejections || 0}</span>
                        <span className="insp-prov-label">Rejections</span>
                      </div>
                      <div className="insp-prov-stat">
                        <span className="insp-prov-num insp-prov-warning">{provNeedVisit}</span>
                        <span className="insp-prov-label">Need Visit</span>
                      </div>
                      <div className="insp-prov-stat">
                        <span className="insp-prov-num insp-prov-owing">{formatR(provTotalOwing)}</span>
                        <span className="insp-prov-label">Outstanding</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}

export default Inspectors;
