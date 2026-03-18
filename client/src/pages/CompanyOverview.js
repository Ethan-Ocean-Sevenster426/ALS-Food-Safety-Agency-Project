import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './PageStyles.css';
import './CompanyOverview.css';

const DETAIL_FIELDS = [
  { key: 'BusinessName', label: 'Business Name' },
  { key: 'ClientID', label: 'Client ID', readOnly: true },
  { key: 'AccountCode', label: 'Account Code', readOnly: true },
  { key: 'Email', label: 'Email' },
  { key: 'Town', label: 'Town' },
  { key: 'CorporateGroup', label: 'Corporate Group' },
  { key: 'GroupType', label: 'Group Type' },
  { key: 'FacilityType', label: 'Facility Type' },
  { key: 'CompanyRegNumber', label: 'Company Reg No.' },
  { key: 'PhysicalAddress', label: 'Physical Address' },
  { key: 'VATNumber', label: 'VAT Number' },
];

const CONTACT_GROUPS = [
  {
    title: 'Abattoir Owner',
    fields: [
      { key: 'AbattoirOwnerName', label: 'Name' },
      { key: 'AbattoirOwnerCell', label: 'Cellphone' },
      { key: 'AbattoirOwnerEmail', label: 'Email' },
    ],
  },
  {
    title: 'Accounts Contact',
    fields: [
      { key: 'AccountsContactName', label: 'Contact Name' },
      { key: 'AccountsTelephone', label: 'Telephone' },
      { key: 'AccountsEmail', label: 'Email' },
    ],
  },
  {
    title: 'Abattoir Manager',
    fields: [
      { key: 'AbattoirManagerName', label: 'Name' },
      { key: 'AbattoirManagerCell', label: 'Cellphone' },
      { key: 'AbattoirManagerEmail', label: 'Email' },
    ],
  },
];

const ALL_EDITABLE = [
  ...DETAIL_FIELDS.filter(f => !f.readOnly),
  ...CONTACT_GROUPS.flatMap(g => g.fields),
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function CompanyOverview() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isAdmin = user.role === 'Super Admin' || user.role === 'Admin';
  const userLabel = `${user.firstName || ''} ${user.lastName || ''} (${user.email || 'unknown'})`.trim();
  const navigate = useNavigate();

  // Company selector state (admin only)
  const [allCompanies, setAllCompanies] = useState([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companySearch, setCompanySearch] = useState('');

  // Active company ID - for admin it's selected, for company users it's from login
  const [activeCompanyId, setActiveCompanyId] = useState(isAdmin ? null : user.clientRecordId);

  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState({});
  const [originalValues, setOriginalValues] = useState({});
  const [saving, setSaving] = useState(false);

  // Users state
  const [companyUsers, setCompanyUsers] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Reset password state
  const [resetModal, setResetModal] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  // Invite state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('User');
  const [inviteSending, setInviteSending] = useState(false);

  // Audit log state
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [auditLog, setAuditLog] = useState([]);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);

  // EPV state
  const [epvList, setEpvList] = useState([]);
  const [epvLoading, setEpvLoading] = useState(false);
  const [epvSending, setEpvSending] = useState(false);

  // ===== FETCH ALL COMPANIES (admin only) =====
  const fetchAllCompanies = useCallback(async () => {
    if (!isAdmin) return;
    setCompaniesLoading(true);
    try {
      const res = await axios.get('http://localhost:5000/api/clients', { params: { limit: 9999 } });
      setAllCompanies(res.data.data);
    } catch (err) {
      console.error('Failed to load companies');
    } finally {
      setCompaniesLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { fetchAllCompanies(); }, [fetchAllCompanies]);

  // ===== FETCH COMPANY DATA =====
  const fetchCompany = useCallback(async () => {
    if (!activeCompanyId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await axios.get(`http://localhost:5000/api/company/${activeCompanyId}`);
      setCompany(res.data.company);
    } catch (err) {
      setError('Failed to load company details.');
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId]);

  const fetchUsers = useCallback(async () => {
    if (!activeCompanyId) return;
    setUsersLoading(true);
    try {
      const res = await axios.get(`http://localhost:5000/api/company/${activeCompanyId}/users`);
      setCompanyUsers(res.data.users);
      setPendingInvites(res.data.pendingInvites);
    } catch (err) {
      console.error('Failed to load users');
    } finally {
      setUsersLoading(false);
    }
  }, [activeCompanyId]);

  const fetchAuditLog = useCallback(async () => {
    if (!activeCompanyId) return;
    setAuditLoading(true);
    try {
      const res = await axios.get(`http://localhost:5000/api/company/${activeCompanyId}/audit-log`, {
        params: { page: auditPage, limit: 50 },
      });
      setAuditLog(res.data.data);
      setAuditTotalPages(res.data.totalPages);
      setAuditTotal(res.data.total);
    } catch (err) {
      console.error('Failed to load audit log');
    } finally {
      setAuditLoading(false);
    }
  }, [activeCompanyId, auditPage]);

  const fetchEPVs = useCallback(async () => {
    if (!activeCompanyId) return;
    setEpvLoading(true);
    try {
      const res = await axios.get(`http://localhost:5000/api/epv/company/${activeCompanyId}`);
      setEpvList(res.data.verifications);
    } catch (err) {
      console.error('Failed to load EPVs');
    } finally {
      setEpvLoading(false);
    }
  }, [activeCompanyId]);

  useEffect(() => { fetchCompany(); }, [fetchCompany]);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { fetchEPVs(); }, [fetchEPVs]);
  useEffect(() => { if (showAuditLog) fetchAuditLog(); }, [fetchAuditLog, showAuditLog]);

  // Reset sub-sections when switching company
  useEffect(() => {
    setEditing(false);
    setEditValues({});
    setOriginalValues({});
    setShowAuditLog(false);
    setAuditPage(1);
    setShowInviteForm(false);
    setError('');
    setSuccessMsg('');
  }, [activeCompanyId]);

  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(''), 4000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  // ===== SWITCH COMPANY (admin) =====
  const selectCompany = (companyId) => {
    setActiveCompanyId(companyId);
  };

  const filteredCompanies = allCompanies.filter(c => {
    if (!companySearch) return true;
    const s = companySearch.toLowerCase();
    return (c.BusinessName || '').toLowerCase().includes(s)
      || (c.ClientID || '').toLowerCase().includes(s)
      || (c.AccountCode || '').toLowerCase().includes(s)
      || (c.Town || '').toLowerCase().includes(s);
  });

  // ===== EDIT =====
  const canEdit = isAdmin || user.role === 'Company Admin';

  const startEdit = () => {
    const values = {};
    ALL_EDITABLE.forEach(f => { values[f.key] = company[f.key] || ''; });
    setEditValues(values);
    setOriginalValues({ ...values });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditValues({});
    setOriginalValues({});
  };

  const saveEdit = async () => {
    const changes = {};
    ALL_EDITABLE.forEach(f => {
      if (editValues[f.key] !== originalValues[f.key]) {
        changes[f.key] = editValues[f.key];
      }
    });

    if (Object.keys(changes).length === 0) {
      cancelEdit();
      return;
    }

    setSaving(true);
    try {
      await axios.put(`http://localhost:5000/api/company/${activeCompanyId}`, {
        updates: changes,
        changedBy: userLabel,
      });
      cancelEdit();
      setSuccessMsg('Company details updated successfully.');
      fetchCompany();
    } catch (err) {
      setError('Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  // ===== INVITE =====
  const sendInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviteSending(true);
    setError('');
    try {
      const res = await axios.post(`http://localhost:5000/api/company/${activeCompanyId}/invite`, {
        email: inviteEmail,
        role: inviteRole,
        invitedBy: userLabel,
      });
      setSuccessMsg(res.data.message);
      setShowInviteForm(false);
      setInviteEmail('');
      setInviteRole('User');
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send invitation.');
    } finally {
      setInviteSending(false);
    }
  };

  // ===== DELETE USER =====
  const executeDeleteUser = async () => {
    if (!deleteConfirm) return;
    try {
      await axios.delete(`http://localhost:5000/api/company/${activeCompanyId}/users/${deleteConfirm.Id}`);
      setDeleteConfirm(null);
      setSuccessMsg(`User "${deleteConfirm.FirstName} ${deleteConfirm.LastName}" removed.`);
      fetchUsers();
    } catch (err) {
      setError('Failed to remove user.');
      setDeleteConfirm(null);
    }
  };

  // ===== RESET PASSWORD =====
  const canResetPassword = user.role === 'Super Admin' || user.role === 'Company Admin';

  const executeResetPassword = async () => {
    if (!resetModal || !resetPassword) return;
    if (resetPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setResetting(true);
    setError('');
    try {
      await axios.put(`http://localhost:5000/api/auth/users/${resetModal.Id}/reset-password`, {
        newPassword: resetPassword,
      });
      setResetModal(null);
      setResetPassword('');
      setSuccessMsg(`Password reset for ${resetModal.FirstName} ${resetModal.LastName}.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset password.');
    } finally {
      setResetting(false);
    }
  };

  // ===== SEND EPV (admin only) =====
  const sendEPV = async () => {
    if (!activeCompanyId) return;
    setEpvSending(true);
    setError('');
    try {
      const res = await axios.post('http://localhost:5000/api/epv/send', {
        clientRecordId: activeCompanyId,
        sentBy: userLabel,
      });
      setSuccessMsg(res.data.message);
      fetchEPVs();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send EPV.');
    } finally {
      setEpvSending(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleString();
  };

  // ===== NO COMPANY SELECTED (admin without selection) =====
  if (isAdmin && !activeCompanyId) {
    return (
      <div className="page-container co-page">
        <div className="page-card co-selector-card">
          <h2>Company Overview</h2>
          <p className="co-selector-desc">Select a business to view its company overview.</p>
          <div className="co-selector-search">
            <input
              type="text"
              placeholder="Search by name, Client ID, Account Code, or Town..."
              value={companySearch}
              onChange={(e) => setCompanySearch(e.target.value)}
              className="co-selector-input"
            />
          </div>
          {companiesLoading ? (
            <p className="co-loading">Loading businesses...</p>
          ) : (
            <div className="co-selector-list">
              {filteredCompanies.length === 0 ? (
                <p className="co-loading">No businesses found.</p>
              ) : (
                filteredCompanies.map(c => (
                  <div key={c.Id} className="co-selector-item" onClick={() => selectCompany(c.Id)}>
                    <div className="co-selector-item-main">
                      <strong>{c.BusinessName || 'Unknown'}</strong>
                      <span className="co-selector-badges">
                        {c.ClientID && <span className="co-selector-badge">{c.ClientID}</span>}
                        {c.AccountCode && <span className="co-selector-badge co-selector-badge-acc">{c.AccountCode}</span>}
                      </span>
                    </div>
                    <div className="co-selector-item-sub">
                      {c.Town && <span>{c.Town}</span>}
                      {c.Email && <span>{c.Email}</span>}
                      {c.VerifiedAt ? (
                        <span className="co-selector-verified">Verified</span>
                      ) : (
                        <span className="co-selector-pending">Pending</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== NO COMPANY for company user =====
  if (!isAdmin && !activeCompanyId) {
    return (
      <div className="page-container co-page">
        <div className="page-card">
          <h2>Company Overview</h2>
          <p className="co-no-company">Your account is not linked to a company. Please contact your administrator.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page-container co-page">
        <div className="page-card">
          <h2>Company Overview</h2>
          <p style={{ color: '#888' }}>Loading company details...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container co-page">
      {error && <p className="co-error">{error}</p>}
      {successMsg && <p className="co-success">{successMsg}</p>}

      {/* Admin: Switch Company Bar */}
      {isAdmin && (
        <div className="co-switch-bar">
          <button className="co-switch-btn" onClick={() => { setActiveCompanyId(null); setCompany(null); setCompanyUsers([]); setPendingInvites([]); setEpvList([]); }}>
            &larr; Switch Business
          </button>
          <span className="co-switch-label">Viewing as {user.role}</span>
        </div>
      )}

      {/* Delete User Modal */}
      {deleteConfirm && (
        <div className="co-modal-overlay">
          <div className="co-modal">
            <h3>Remove User</h3>
            <p>Are you sure you want to remove this user from this company?</p>
            <div className="co-modal-record">
              <strong>{deleteConfirm.FirstName} {deleteConfirm.LastName}</strong><br />
              {deleteConfirm.Email} — {deleteConfirm.Role}
            </div>
            <p className="co-modal-warning">This will delete their account.</p>
            <div className="co-modal-actions">
              <button className="co-delete-confirm-btn" onClick={executeDeleteUser}>Yes, Remove</button>
              <button className="co-cancel-btn" onClick={() => setDeleteConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetModal && (
        <div className="co-modal-overlay">
          <div className="co-modal">
            <h3 style={{ color: '#0E7C7B' }}>Reset Password</h3>
            <p>Set a new password for:</p>
            <div className="co-modal-record">
              <strong>{resetModal.FirstName} {resetModal.LastName}</strong><br />
              {resetModal.Email}
            </div>
            <div style={{ margin: '16px 0' }}>
              <input
                type="password"
                placeholder="New password (min 6 characters)"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className="co-input"
              />
            </div>
            <div className="co-modal-actions">
              <button className="co-save-btn" onClick={executeResetPassword} disabled={resetting || resetPassword.length < 6}>
                {resetting ? 'Resetting...' : 'Reset Password'}
              </button>
              <button className="co-cancel-btn" onClick={() => { setResetModal(null); setResetPassword(''); }} disabled={resetting}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== COMPANY HEADER ===== */}
      <div className="page-card co-header-card">
        <div className="co-header">
          <div>
            <h2>{company?.BusinessName || 'Company Overview'}</h2>
            <p className="co-subtitle">
              {company?.ClientID && <span className="co-client-id">{company.ClientID}</span>}
              {company?.AccountCode && <span className="co-account-code">{company.AccountCode}</span>}
              {company?.Town && <span className="co-town">{company.Town}</span>}
            </p>
          </div>
          <div className="co-header-badges">
            {company?.VerifiedAt ? (
              <span className="co-verified-badge">Verified</span>
            ) : (
              <span className="co-pending-badge">Pending Verification</span>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="co-stats">
          <div className="co-stat">
            <span className="co-stat-number">{companyUsers.length}</span>
            <span className="co-stat-label">Active Users</span>
          </div>
          <div className="co-stat">
            <span className="co-stat-number">{pendingInvites.length}</span>
            <span className="co-stat-label">Pending Invites</span>
          </div>
          <div className="co-stat">
            <span className="co-stat-number co-stat-coming-soon">—</span>
            <span className="co-stat-label">Invoices</span>
          </div>
          <div className="co-stat">
            <span className="co-stat-number">{epvList.filter(e => e.Status === 'Pending').length}</span>
            <span className="co-stat-label">Verifications Due</span>
          </div>
          <div className="co-stat">
            <span className="co-stat-number">{epvList.filter(e => e.Status === 'Completed').length}</span>
            <span className="co-stat-label">Completed</span>
          </div>
        </div>
      </div>

      {/* ===== COMPANY DETAILS ===== */}
      <div className="page-card co-section">
        <div className="co-section-header">
          <h3>Company Details</h3>
          {canEdit && !editing ? (
            <button className="co-edit-btn" onClick={startEdit}>Edit Details</button>
          ) : editing ? (
            <div className="co-edit-actions">
              <button className="co-save-btn" onClick={saveEdit} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
              <button className="co-cancel-btn" onClick={cancelEdit} disabled={saving}>Cancel</button>
            </div>
          ) : null}
        </div>

        <div className="co-details-grid">
          {DETAIL_FIELDS.map(f => (
            <div key={f.key} className="co-detail-item">
              <label>{f.label}</label>
              {editing && !f.readOnly ? (
                <input
                  type="text"
                  className={`co-input ${editValues[f.key] !== originalValues[f.key] ? 'co-changed' : ''}`}
                  value={editValues[f.key]}
                  onChange={(e) => setEditValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                />
              ) : (
                <span className="co-detail-value">{company?.[f.key] || '—'}</span>
              )}
            </div>
          ))}
        </div>

        {/* Contact Groups */}
        <div className="co-contacts">
          {CONTACT_GROUPS.map(group => (
            <div key={group.title} className="co-contact-group">
              <h4>{group.title}</h4>
              <div className="co-contact-fields">
                {group.fields.map(f => (
                  <div key={f.key} className="co-detail-item">
                    <label>{f.label}</label>
                    {editing ? (
                      <input
                        type="text"
                        className={`co-input ${editValues[f.key] !== originalValues[f.key] ? 'co-changed' : ''}`}
                        value={editValues[f.key]}
                        onChange={(e) => setEditValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                      />
                    ) : (
                      <span className="co-detail-value">{company?.[f.key] || '—'}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ===== USERS ===== */}
      <div className="page-card co-section">
        <div className="co-section-header">
          <h3>Users ({companyUsers.length})</h3>
          {(isAdmin || user.role === 'Company Admin') && (
            <button className="co-invite-btn" onClick={() => setShowInviteForm(!showInviteForm)}>
              {showInviteForm ? 'Cancel' : '+ Invite User'}
            </button>
          )}
        </div>

        {showInviteForm && (
          <form className="co-invite-form" onSubmit={sendInvite}>
            <input
              type="email"
              placeholder="Email address"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="co-input"
              required
            />
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="co-input co-role-select">
              <option value="User">User</option>
              <option value="Company Admin">Company Admin</option>
            </select>
            <button type="submit" className="co-send-invite-btn" disabled={inviteSending}>
              {inviteSending ? 'Sending...' : 'Send Invite'}
            </button>
          </form>
        )}

        {usersLoading ? (
          <p className="co-loading">Loading users...</p>
        ) : (
          <>
            <table className="co-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {companyUsers.length === 0 ? (
                  <tr><td colSpan="5" className="co-loading">No users yet.</td></tr>
                ) : (
                  companyUsers.map(u => (
                    <tr key={u.Id}>
                      <td>{u.FirstName} {u.LastName}</td>
                      <td>{u.Email}</td>
                      <td><span className={`co-role-badge co-role-${u.Role.toLowerCase().replace(/\s/g, '-')}`}>{u.Role}</span></td>
                      <td className="co-date">{formatDate(u.CreatedAt)}</td>
                      <td className="co-user-actions">
                        {canResetPassword && (
                          <button
                            className="co-reset-btn"
                            onClick={() => { setResetModal(u); setResetPassword(''); }}
                            title="Reset password"
                          >
                            Reset PW
                          </button>
                        )}
                        {(isAdmin || user.role === 'Company Admin') && (
                          <button
                            className="co-remove-btn"
                            onClick={() => setDeleteConfirm(u)}
                            disabled={u.Email === user.email}
                            title={u.Email === user.email ? "Can't remove yourself" : 'Remove user'}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {pendingInvites.length > 0 && (
              <div className="co-pending-section">
                <h4>Pending Invitations</h4>
                {pendingInvites.map(inv => (
                  <div key={inv.Id} className="co-pending-item">
                    <span>{inv.Email}</span>
                    <span className="co-pending-role">{inv.Role}</span>
                    <span className="co-date">{formatDate(inv.CreatedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ===== CHANGE LOG ===== */}
      <div className="page-card co-section">
        <div className="co-section-header">
          <h3>Change Log ({auditTotal})</h3>
          <button className="co-toggle-btn" onClick={() => { setShowAuditLog(!showAuditLog); setAuditPage(1); }}>
            {showAuditLog ? 'Hide' : 'Show'}
          </button>
        </div>

        {showAuditLog && (
          <>
            {auditLoading ? (
              <p className="co-loading">Loading change log...</p>
            ) : auditLog.length === 0 ? (
              <p className="co-loading">No changes recorded yet.</p>
            ) : (
              <table className="co-table co-audit-table">
                <thead>
                  <tr>
                    <th>Date/Time</th>
                    <th>Field</th>
                    <th>Old Value</th>
                    <th>New Value</th>
                    <th>Changed By</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map(entry => (
                    <tr key={entry.Id}>
                      <td className="co-date">{formatDate(entry.ChangedAt)}</td>
                      <td><span className={`co-field-badge ${entry.FieldName.startsWith('_') ? 'co-badge-event' : ''}`}>{entry.FieldName}</span></td>
                      <td className="co-old-value">{entry.OldValue || '—'}</td>
                      <td className="co-new-value">{entry.NewValue || '—'}</td>
                      <td>{entry.ChangedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {auditTotalPages > 1 && (
              <div className="co-pagination">
                <button onClick={() => setAuditPage(p => Math.max(1, p - 1))} disabled={auditPage === 1} className="co-page-btn">Previous</button>
                <span className="co-page-info">Page {auditPage} of {auditTotalPages}</span>
                <button onClick={() => setAuditPage(p => Math.min(auditTotalPages, p + 1))} disabled={auditPage === auditTotalPages} className="co-page-btn">Next</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ===== EGG PRODUCTION VERIFICATIONS ===== */}
      <div className="page-card co-section">
        <div className="co-section-header">
          <h3>Egg Production Verifications ({epvList.length})</h3>
          {isAdmin && (
            <button className="co-epv-send-btn" onClick={sendEPV} disabled={epvSending}>
              {epvSending ? 'Sending...' : 'Send EPV'}
            </button>
          )}
        </div>

        {epvLoading ? (
          <p className="co-loading">Loading verifications...</p>
        ) : epvList.length === 0 ? (
          <p className="co-loading">No verifications sent yet.{isAdmin ? ' Click "Send EPV" to send the first one.' : ' Your administrator will send the first one.'}</p>
        ) : (
          <table className="co-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Completed</th>
                <th>Completed By</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {epvList.map(epv => (
                <tr key={epv.Id}>
                  <td className="co-epv-period">
                    {MONTH_NAMES[(epv.PeriodMonth || 1) - 1]} {epv.PeriodYear}
                  </td>
                  <td>
                    <span className={`co-epv-status co-epv-${epv.Status.toLowerCase()}`}>
                      {epv.Status}
                    </span>
                  </td>
                  <td className="co-date">{formatDate(epv.SentAt)}</td>
                  <td className="co-date">{epv.CompletedAt ? formatDate(epv.CompletedAt) : '—'}</td>
                  <td>{epv.CompletedBy || '—'}</td>
                  <td className="co-epv-actions">
                    {epv.Status === 'Pending' ? (
                      <button className="co-epv-complete-btn" onClick={() => navigate(`/epv/${epv.Token}`)}>
                        Complete
                      </button>
                    ) : (isAdmin || user.role === 'Company Admin') ? (
                      <button className="co-epv-edit-btn" onClick={() => navigate(`/epv/${epv.Token}`)}>
                        View / Edit
                      </button>
                    ) : (
                      <button className="co-epv-view-btn" onClick={() => navigate(`/epv/${epv.Token}`)}>
                        View
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ===== FUTURE SECTIONS ===== */}
      <div className="co-future-cards">
        <div className="page-card co-future-card">
          <div className="co-future-icon">📄</div>
          <h3>Invoices</h3>
          <p>View and manage invoices for your business.</p>
          <span className="co-coming-soon">Coming Soon</span>
        </div>
      </div>
    </div>
  );
}

export default CompanyOverview;
