import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import './PageStyles.css';
import './SuperCollections.css';

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const formatR = (n) => 'R ' + (Number(n) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatNum = (n) => (Number(n) || 0).toLocaleString('en-ZA');

function SuperCollections() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const userLabel = `${user.firstName || ''} ${user.lastName || ''} (${user.email || 'unknown'})`.trim();

  const [rows, setRows] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [year, setYear]                     = useState('');
  const [month, setMonth]                   = useState('');
  const [search, setSearch]                 = useState('');
  const [invoiceSent, setInvoiceSent]       = useState('');
  const [reconciled, setReconciled]         = useState('');
  const [approvalStatus, setApprovalStatus] = useState('');

  const [expandedId, setExpandedId] = useState(null);
  const [saving, setSaving] = useState(null);
  const [reconcileAmount, setReconcileAmount] = useState({});
  const [commentDraft, setCommentDraft] = useState({});
  const [history, setHistory] = useState({}); // { [epvId]: entries[] }
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadHistory = useCallback(async (epvId) => {
    setHistoryLoading(true);
    try {
      const res = await axios.get(`/api/als/${epvId}/history`);
      setHistory(prev => ({ ...prev, [epvId]: res.data.data || [] }));
    } catch (err) {
      setHistory(prev => ({ ...prev, [epvId]: [] }));
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Silently re-fetch history for the currently-expanded row after any save,
  // so the transparency log stays in sync.
  useEffect(() => {
    if (expandedId != null) loadHistory(expandedId);
  }, [expandedId, loadHistory]);

  const buildParams = useCallback(() => {
    const p = {};
    if (year) p.year = year;
    if (month) p.month = month;
    if (search) p.search = search;
    if (invoiceSent) p.invoiceSent = invoiceSent;
    if (reconciled) p.reconciled = reconciled;
    if (approvalStatus) p.approvalStatus = approvalStatus;
    return p;
  }, [year, month, search, invoiceSent, reconciled, approvalStatus]);

  const load = useCallback(async ({ silent = false } = {}) => {
    // Silent refreshes (after a save / toggle) don't flip loading, so the
    // table doesn't briefly unmount its rows — expanded panels stay open.
    if (!silent) setLoading(true);
    setError('');
    try {
      const params = buildParams();
      const [listRes, kpiRes] = await Promise.all([
        axios.get('/api/als/invoiceable', { params }),
        axios.get('/api/als/kpis', { params: { year: params.year, month: params.month } }),
      ]);
      setRows(listRes.data.data || []);
      setKpis(kpiRes.data);
      setReconcileAmount(prev => {
        const next = { ...prev };
        for (const r of listRes.data.data || []) {
          // Only overwrite if the user hasn't touched the input yet.
          if (next[r.Id] == null) {
            next[r.Id] = r.ReconciledAmount != null ? r.ReconciledAmount : r.InvoiceAmount;
          }
        }
        return next;
      });
      setCommentDraft(prev => {
        const next = { ...prev };
        for (const r of listRes.data.data || []) {
          if (next[r.Id] == null) next[r.Id] = r.SuperComment || '';
        }
        return next;
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load ALS collections.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(''), 2500);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  const toggleInvoiceSent = async (row) => {
    setSaving(row.Id + ':sent');
    try {
      await axios.put(`/api/als/${row.Id}/invoice-sent`, { sent: !row.SuperInvoiceSent, by: userLabel, byRole: user.role });
      setSuccessMsg(!row.SuperInvoiceSent ? 'Invoice marked as sent.' : 'Invoice-sent flag cleared.');
      load({ silent: true });
      loadHistory(row.Id);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update.');
    } finally {
      setSaving(null);
    }
  };

  const saveReconcile = async (row, reconciledNow) => {
    setSaving(row.Id + ':rec');
    try {
      const amount = reconciledNow ? parseFloat(reconcileAmount[row.Id] ?? row.InvoiceAmount) : null;
      await axios.put(`/api/als/${row.Id}/reconcile`, {
        reconciled: reconciledNow,
        amount,
        by: userLabel, byRole: user.role,
      });
      setSuccessMsg(reconciledNow ? 'Payment recorded.' : 'Reconciliation cleared.');
      load({ silent: true });
      loadHistory(row.Id);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update.');
    } finally {
      setSaving(null);
    }
  };

  const saveComment = async (row) => {
    setSaving(row.Id + ':cmt');
    try {
      await axios.put(`/api/als/${row.Id}/comment`, { comment: commentDraft[row.Id] || '', by: userLabel, byRole: user.role });
      setSuccessMsg('Comment saved.');
      load({ silent: true });
      loadHistory(row.Id);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save comment.');
    } finally {
      setSaving(null);
    }
  };

  const uploadInvoice = async (row, file) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { setError('File larger than 15 MB.'); return; }
    setSaving(row.Id + ':up');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('uploadedBy', userLabel);
      fd.append('uploadedByRole', user.role || '');
      await axios.post(`/api/als/${row.Id}/invoice-file`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSuccessMsg('Invoice uploaded.');
      load({ silent: true });
      loadHistory(row.Id);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to upload invoice.');
    } finally {
      setSaving(null);
    }
  };

  const removeInvoice = async (row) => {
    if (!window.confirm('Remove this invoice file?')) return;
    setSaving(row.Id + ':del');
    try {
      await axios.delete(`/api/als/${row.Id}/invoice-file`, { data: { by: userLabel, byRole: user.role } });
      setSuccessMsg('Invoice removed.');
      load({ silent: true });
      loadHistory(row.Id);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to remove.');
    } finally {
      setSaving(null);
    }
  };

  const exportExcel = async () => {
    try {
      const params = new URLSearchParams(buildParams());
      const res = await fetch(`/api/als/export.xlsx?${params.toString()}`);
      // Prefer server-provided filename (nicely named ALS Collections Report ...)
      if (!res.ok) { setError('Export failed.'); return; }
      const disposition = res.headers.get('content-disposition') || '';
      const match = disposition.match(/filename\*?="?([^";]+)"?/i);
      const fileName = match ? decodeURIComponent(match[1].replace(/^UTF-8''/, '')) : `ALS Collections Report ${new Date().toISOString().slice(0, 10)}.xlsx`;
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Export failed. ' + (err.message || ''));
    }
  };

  const clearFilters = () => {
    setYear(''); setMonth(''); setSearch('');
    setInvoiceSent(''); setReconciled(''); setApprovalStatus('');
  };

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  return (
    <div className="page-container super-page">
      <div className="page-card">
        <div className="super-header">
          <div>
            <h2 style={{ color: '#0E7C7B', margin: 0 }}>ALS Collections</h2>
            <p style={{ color: '#666', margin: '6px 0 0' }}>
              Levy invoicing worklist for ALS. Only inspection-cleared EPVs appear here.
              <br />
              <strong style={{ fontSize: 12, color: '#dc2626' }}>All amounts throughout the system exclude VAT.</strong>
            </p>
          </div>
          <button className="super-export-btn" onClick={exportExcel}>Export to Excel</button>
        </div>

        {error && <div className="super-error">{error}</div>}
        {successMsg && <div className="super-success">{successMsg}</div>}

        {/* KPI ribbon */}
        <div className="super-kpi-row">
          <div className="super-kpi">
            <div className="super-kpi-label">Invoiceable</div>
            <div className="super-kpi-value">{formatNum(kpis?.totalInvoiceable)}</div>
          </div>
          <div className="super-kpi">
            <div className="super-kpi-label">Invoices Sent</div>
            <div className="super-kpi-value">{formatNum(kpis?.invoicesSent)} / {formatNum(kpis?.totalInvoiceable)}</div>
          </div>
          <div className="super-kpi">
            <div className="super-kpi-label">Reconciled</div>
            <div className="super-kpi-value">{formatNum(kpis?.reconciled)} / {formatNum(kpis?.totalInvoiceable)}</div>
          </div>
          <div className="super-kpi">
            <div className="super-kpi-label">Total Billable <span style={{ color: '#dc2626' }}>(excl VAT)</span></div>
            <div className="super-kpi-value">{formatR(kpis?.totalBillable)}</div>
          </div>
          <div className="super-kpi">
            <div className="super-kpi-label">Total Collected <span style={{ color: '#dc2626' }}>(excl VAT)</span></div>
            <div className="super-kpi-value super-kpi-good">{formatR(kpis?.totalCollected)}</div>
          </div>
          <div className="super-kpi">
            <div className="super-kpi-label">Outstanding <span style={{ color: '#dc2626' }}>(excl VAT)</span></div>
            <div className="super-kpi-value super-kpi-warn">{formatR(kpis?.totalOutstanding)}</div>
          </div>
          <div className="super-kpi">
            <div className="super-kpi-label">Collection Rate</div>
            <div className="super-kpi-value" style={{ color: (kpis?.collectionRate || 0) >= 80 ? '#16a34a' : '#d97706' }}>
              {kpis?.collectionRate || 0}%
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="super-filter-row">
          <input
            className="super-input"
            placeholder="Search by facility, account code or reference..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="super-input" value={year} onChange={e => setYear(e.target.value)}>
            <option value="">All years</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="super-input" value={month} onChange={e => setMonth(e.target.value)}>
            <option value="">All months</option>
            {MONTHS.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select className="super-input" value={approvalStatus} onChange={e => setApprovalStatus(e.target.value)}>
            <option value="">All approvals</option>
            <option value="approved">Approved only</option>
            <option value="rejected">Rejected (use inspector figures)</option>
          </select>
          <select className="super-input" value={invoiceSent} onChange={e => setInvoiceSent(e.target.value)}>
            <option value="">All invoices</option>
            <option value="true">Invoice sent</option>
            <option value="false">Invoice not sent</option>
          </select>
          <select className="super-input" value={reconciled} onChange={e => setReconciled(e.target.value)}>
            <option value="">All payments</option>
            <option value="true">Reconciled</option>
            <option value="false">Unreconciled</option>
          </select>
          {(year || month || search || invoiceSent || reconciled || approvalStatus) && (
            <button className="super-btn super-btn-secondary" onClick={clearFilters}>Clear filters</button>
          )}
        </div>

        {/* Table */}
        <div className="super-table-wrap">
          <table className="super-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Facility</th>
                <th>Period</th>
                <th>Approval</th>
                <th>Invoice Amount<br /><span style={{ fontSize: 10, color: '#dc2626', fontWeight: 500 }}>excl VAT</span></th>
                <th>Invoice Sent</th>
                <th>ALS Invoice</th>
                <th>POP</th>
                <th>Reconciled</th>
                <th>Paid<br /><span style={{ fontSize: 10, color: '#dc2626', fontWeight: 500 }}>excl VAT</span></th>
                <th>Outstanding<br /><span style={{ fontSize: 10, color: '#dc2626', fontWeight: 500 }}>excl VAT</span></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="12" style={{ textAlign: 'center', padding: 30, color: '#888' }}>Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan="12" style={{ textAlign: 'center', padding: 30, color: '#888' }}>No EPVs waiting to be invoiced.</td></tr>
              ) : (
                rows.map(r => {
                  const paid = Number(r.ReconciledAmount) || 0;
                  const owed = Number(r.InvoiceAmount) || 0;
                  const outstanding = Math.max(0, owed - paid);
                  const isExpanded = expandedId === r.Id;
                  const savingKey = (k) => saving === `${r.Id}:${k}`;
                  return (
                    <React.Fragment key={r.Id}>
                      <tr
                        className={`super-row ${r.IsReconciled ? 'super-row-reconciled' : ''}`}
                        onClick={() => setExpandedId(isExpanded ? null : r.Id)}
                      >
                        <td className="super-mono">{r.ReferenceNumber || '—'}</td>
                        <td><strong>{r.BusinessName}</strong><br /><span style={{ color: '#888', fontSize: 12 }}>{r.AccountCode || '—'}</span></td>
                        <td>{MONTHS[r.PeriodMonth]?.slice(0, 3)} '{String(r.PeriodYear).slice(2)}</td>
                        <td>
                          {r.ApprovalStatus === 'Approved'
                            ? <span className="super-badge super-badge-ok">Approved</span>
                            : <span className="super-badge super-badge-warn">Rejected → Insp</span>}
                        </td>
                        <td className="super-mono"><strong>{formatR(owed)}</strong></td>
                        <td onClick={e => e.stopPropagation()}>
                          <label className="super-check">
                            <input
                              type="checkbox"
                              checked={!!r.SuperInvoiceSent}
                              disabled={savingKey('sent')}
                              onChange={() => toggleInvoiceSent(r)}
                            />
                            <span>{r.SuperInvoiceSent ? 'Sent' : 'Send'}</span>
                          </label>
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          {r.SuperInvoiceFilePath ? (
                            <a
                              href={`/api/als/${r.Id}/invoice-file`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="super-link"
                            >
                              View
                            </a>
                          ) : (
                            <span style={{ color: '#888' }}>—</span>
                          )}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          {r.POPFilePath ? (
                            <a
                              href={`/api/als/pop/${r.Id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="super-link"
                            >
                              View POP
                            </a>
                          ) : (
                            <span style={{ color: '#888' }}>—</span>
                          )}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <label className="super-check">
                            <input
                              type="checkbox"
                              checked={!!r.IsReconciled}
                              disabled={savingKey('rec')}
                              onChange={() => saveReconcile(r, !r.IsReconciled)}
                            />
                            <span>{r.IsReconciled ? 'Paid' : 'Mark'}</span>
                          </label>
                        </td>
                        <td className="super-mono">{r.IsReconciled ? formatR(paid) : '—'}</td>
                        <td className="super-mono" style={{ color: outstanding > 0 ? '#dc2626' : '#16a34a' }}>
                          {formatR(outstanding)}
                        </td>
                        <td>
                          <button className="super-btn super-btn-ghost" onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : r.Id); }}>
                            {isExpanded ? '−' : '+'}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="super-details-row">
                          <td colSpan="12">
                            <div className="super-details">
                              <div className="super-details-col">
                                <h4>Completed EPV — sales used for the levy</h4>
                                <p style={{ fontSize: 11, color: '#666', marginTop: -4, marginBottom: 8 }}>
                                  {r.ApprovalStatus === 'Rejected'
                                    ? 'Facility EPV was rejected — figures below come from the Inspector\'s revised EPV.'
                                    : 'Facility EPV was approved — figures below come from the Facility\'s submitted EPV.'}
                                </p>
                                <div className="super-kv"><span>Eggs sold to trade</span><strong>{formatNum(r.InvoiceEggsSoldToTrade)} dozen</strong></div>
                                <div className="super-kv"><span>Pulp sold to trade</span><strong>{formatNum(r.InvoicePulpSoldToTrade)} kg</strong></div>
                                <div className="super-kv"><span>Powder sold to trade</span><strong>{formatNum(r.InvoicePowderSoldToTrade)} kg</strong></div>
                                <div className="super-kv-divider" />
                                <div className="super-kv"><span>Egg levy <span style={{ color: '#dc2626' }}>(excl VAT)</span></span>{r.ApprovalStatus === 'Rejected' ? formatR(r.InspectorEggLevy) : formatR(r.FacilityEggLevy)}</div>
                                <div className="super-kv"><span>Pulp levy <span style={{ color: '#dc2626' }}>(excl VAT)</span></span>{r.ApprovalStatus === 'Rejected' ? formatR(r.InspectorPulpLevy) : formatR(r.FacilityPulpLevy)}</div>
                                <div className="super-kv"><span>Powder levy <span style={{ color: '#dc2626' }}>(excl VAT)</span></span>{r.ApprovalStatus === 'Rejected' ? formatR(r.InspectorPowderLevy) : formatR(r.FacilityPowderLevy)}</div>
                                <div className="super-kv-divider" />
                                <div className="super-kv" style={{ fontSize: 15 }}>
                                  <span>Invoice on <span style={{ color: '#dc2626', fontSize: 11 }}>(excl VAT)</span></span>
                                  <strong style={{ color: '#0E7C7B' }}>{formatR(r.InvoiceAmount)}</strong>
                                </div>
                                {r.InspectorEpvId && (
                                  <details style={{ marginTop: 10 }}>
                                    <summary style={{ cursor: 'pointer', fontSize: 12, color: '#666' }}>
                                      Show both facility and inspector figures side-by-side
                                    </summary>
                                    <div style={{ marginTop: 8, padding: '8px 10px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                                      <div className="super-kv"><span>Facility eggs → trade</span>{formatNum(r.FacilityEggsSoldToTrade)} doz</div>
                                      <div className="super-kv"><span>Facility pulp → trade</span>{formatNum(r.FacilityPulpSoldToTrade)} kg</div>
                                      <div className="super-kv"><span>Facility powder → trade</span>{formatNum(r.FacilityPowderSoldToTrade)} kg</div>
                                      <div className="super-kv"><span>Facility total</span>{formatR(r.FacilityTotal)}</div>
                                      <div className="super-kv-divider" />
                                      <div className="super-kv"><span>Inspector eggs → trade</span>{formatNum(r.InspectorEggsSoldToTrade)} doz</div>
                                      <div className="super-kv"><span>Inspector pulp → trade</span>{formatNum(r.InspectorPulpSoldToTrade)} kg</div>
                                      <div className="super-kv"><span>Inspector powder → trade</span>{formatNum(r.InspectorPowderSoldToTrade)} kg</div>
                                      <div className="super-kv"><span>Inspector total</span>{formatR(r.InspectorTotal)}</div>
                                    </div>
                                  </details>
                                )}
                              </div>

                              <div className="super-details-col">
                                <h4>ALS invoice PDF</h4>
                                {r.SuperInvoiceFilePath ? (
                                  <div>
                                    <div style={{ marginBottom: 8 }}>
                                      <a href={`/api/als/${r.Id}/invoice-file`} target="_blank" rel="noopener noreferrer" className="super-link">
                                        {r.SuperInvoiceOriginalName || 'Download'}
                                      </a>
                                      <div style={{ fontSize: 12, color: '#888' }}>
                                        Uploaded {r.SuperInvoiceUploadedAt ? new Date(r.SuperInvoiceUploadedAt).toLocaleString() : ''} by {r.SuperInvoiceUploadedBy || '—'}
                                      </div>
                                    </div>
                                    <button className="super-btn super-btn-danger" onClick={() => removeInvoice(r)} disabled={savingKey('del')}>
                                      {savingKey('del') ? 'Removing…' : 'Remove'}
                                    </button>
                                  </div>
                                ) : (
                                  <div>
                                    <label className="super-btn super-btn-primary" style={{ cursor: 'pointer' }}>
                                      {savingKey('up') ? 'Uploading…' : 'Upload invoice (PDF/PNG/JPG, ≤ 15 MB)'}
                                      <input
                                        type="file"
                                        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*"
                                        style={{ display: 'none' }}
                                        disabled={savingKey('up')}
                                        onChange={(e) => {
                                          const f = e.target.files?.[0];
                                          if (f) uploadInvoice(r, f);
                                          e.target.value = '';
                                        }}
                                      />
                                    </label>
                                  </div>
                                )}
                              </div>

                              <div className="super-details-col">
                                <h4>Payment</h4>
                                <div className="super-kv"><span>Amount owed</span><strong>{formatR(r.InvoiceAmount)}</strong></div>
                                <div className="super-kv"><span>Facility POP</span>{r.POPFilePath ? <a href={`/api/als/pop/${r.Id}`} target="_blank" rel="noopener noreferrer" className="super-link">View</a> : '—'}</div>
                                {r.POPComment && (
                                  <div className="super-kv"><span>POP note</span>{r.POPComment}</div>
                                )}
                                <div style={{ marginTop: 12 }}>
                                  <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 6, fontWeight: 600 }}>
                                    Amount received <span style={{ color: '#dc2626', fontSize: 10, fontWeight: 700 }}>(excl VAT)</span>
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    className="super-input"
                                    value={reconcileAmount[r.Id] ?? ''}
                                    onChange={(e) => setReconcileAmount(prev => ({ ...prev, [r.Id]: e.target.value }))}
                                    placeholder="e.g. 1500.00"
                                  />
                                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                    <button
                                      className="super-btn super-btn-primary"
                                      disabled={savingKey('rec')}
                                      onClick={() => saveReconcile(r, true)}
                                    >
                                      {savingKey('rec') ? 'Saving…' : (r.IsReconciled ? 'Update payment' : 'Mark paid')}
                                    </button>
                                    {r.IsReconciled && (
                                      <button
                                        className="super-btn super-btn-secondary"
                                        disabled={savingKey('rec')}
                                        onClick={() => saveReconcile(r, false)}
                                      >
                                        Clear
                                      </button>
                                    )}
                                  </div>
                                  {r.IsReconciled && r.SuperReconciledBy && (
                                    <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                                      Reconciled by {r.SuperReconciledBy} on {new Date(r.SuperReconciledAt).toLocaleString()}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="super-details-col">
                                <h4>ALS comment</h4>
                                <textarea
                                  className="super-input super-textarea"
                                  rows={4}
                                  value={commentDraft[r.Id] || ''}
                                  onChange={(e) => setCommentDraft(prev => ({ ...prev, [r.Id]: e.target.value }))}
                                  placeholder="Notes for this EPV (visible to ALS and Super Admins)"
                                />
                                <button
                                  className="super-btn super-btn-primary"
                                  style={{ marginTop: 6 }}
                                  disabled={savingKey('cmt')}
                                  onClick={() => saveComment(r)}
                                >
                                  {savingKey('cmt') ? 'Saving…' : 'Save comment'}
                                </button>
                              </div>
                            </div>

                            <div style={{ padding: '0 20px 16px' }}>
                              <h4 style={{ color: '#0E7C7B', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.4px', margin: '4px 0 10px' }}>
                                History &middot; transparency log
                              </h4>
                              {historyLoading && !history[r.Id] ? (
                                <div style={{ fontSize: 13, color: '#888' }}>Loading history…</div>
                              ) : (history[r.Id] && history[r.Id].length > 0) ? (
                                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff' }}>
                                  <table className="super-table" style={{ width: '100%', fontSize: 12 }}>
                                    <thead>
                                      <tr>
                                        <th style={{ width: 150 }}>When</th>
                                        <th style={{ width: 180 }}>Action</th>
                                        <th>From</th>
                                        <th>To</th>
                                        <th style={{ width: 220 }}>By</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {history[r.Id].map(h => (
                                        <tr key={h.Id}>
                                          <td style={{ whiteSpace: 'nowrap' }}>{new Date(h.ChangedAt).toLocaleString()}</td>
                                          <td><strong>{h.FieldName}</strong></td>
                                          <td style={{ color: '#888', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h.OldValue || ''}>
                                            {h.OldValue || '—'}
                                          </td>
                                          <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h.NewValue || ''}>
                                            {h.NewValue || '—'}
                                          </td>
                                          <td>
                                            {h.ChangedBy}
                                            {h.ChangedByRole && (
                                              <span style={{
                                                marginLeft: 6, padding: '1px 6px', borderRadius: 4,
                                                background: h.ChangedByRole === 'Super Admin' ? '#e0e7ff' : '#d1fae5',
                                                color: h.ChangedByRole === 'Super Admin' ? '#3730a3' : '#065f46',
                                                fontSize: 10, fontWeight: 700,
                                              }}>
                                                {h.ChangedByRole}
                                              </span>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div style={{ fontSize: 13, color: '#888' }}>No actions logged yet for this EPV.</div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default SuperCollections;
