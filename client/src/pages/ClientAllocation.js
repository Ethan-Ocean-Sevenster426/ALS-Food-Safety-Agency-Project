import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import './PageStyles.css';
import './ClientAllocation.css';

// Main visible columns in the table
const TABLE_FIELDS = [
  { key: 'ClientID', label: 'Client ID' },
  { key: 'BusinessName', label: 'Business Name' },
  { key: 'AccountCode', label: 'Acc. Code', readOnly: true },
  { key: 'Email', label: 'Email' },
  { key: 'Town', label: 'Town' },
  { key: 'FacilityType', label: 'Facility Type' },
  { key: 'FacilityProvince', label: 'Province' },
  { key: 'CompanyRegNumber', label: 'Reg No.' },
  { key: 'PhysicalAddress', label: 'Physical Address' },
  { key: 'VATNumber', label: 'VAT No.' },
];

// Expandable detail groups (shown below the row)
const DETAIL_GROUPS = [
  {
    key: 'owner',
    label: 'Owner',
    fields: [
      { key: 'AbattoirOwnerName', label: 'Owner Name' },
      { key: 'AbattoirOwnerCell', label: 'Owner Cell' },
      { key: 'AbattoirOwnerEmail', label: 'Owner Email' },
    ],
  },
  {
    key: 'accounts',
    label: 'Accounts',
    fields: [
      { key: 'AccountsContactName', label: 'Accounts Contact' },
      { key: 'AccountsTelephone', label: 'Accounts Tel' },
      { key: 'AccountsEmail', label: 'Accounts Email' },
    ],
  },
  {
    key: 'manager',
    label: 'Manager',
    fields: [
      { key: 'AbattoirManagerName', label: 'Manager Name' },
      { key: 'AbattoirManagerCell', label: 'Manager Cell' },
      { key: 'AbattoirManagerEmail', label: 'Manager Email' },
    ],
  },
];

// All fields combined (for edit/add operations)
const ALL_FIELDS = [
  ...TABLE_FIELDS,
  ...DETAIL_GROUPS.flatMap(g => g.fields),
];

const emptyRow = () => {
  const obj = {};
  ALL_FIELDS.forEach(f => { obj[f.key] = ''; });
  return obj;
};

function ClientAllocation() {
  const [clients, setClients] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [originalValues, setOriginalValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [auditLog, setAuditLog] = useState([]);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditRecordFilter, setAuditRecordFilter] = useState('');
  const [showAddRow, setShowAddRow] = useState(false);
  const [newRow, setNewRow] = useState(emptyRow());
  const [addingSaving, setAddingSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [inviteModal, setInviteModal] = useState(null);
  const [inviteRole, setInviteRole] = useState('Company Admin');
  const [inviteSending, setInviteSending] = useState(false);
  const [expandedRows, setExpandedRows] = useState({});
  const [epvSending, setEpvSending] = useState(null); // clientRecordId being sent
  const limit = 50;

  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const userLabel = `${user.firstName || ''} ${user.lastName || ''} (${user.email || 'unknown'})`.trim();

  const fetchClients = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get('http://localhost:5000/api/clients', {
        params: { page, limit, search },
      });
      setClients(res.data.data);
      setTotalPages(res.data.totalPages);
      setTotal(res.data.total);
    } catch (err) {
      setError('Failed to load client data.');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  const fetchAuditLog = useCallback(async () => {
    setAuditLoading(true);
    try {
      const params = { page: auditPage, limit: 50 };
      if (auditRecordFilter) params.recordId = auditRecordFilter;
      const res = await axios.get('http://localhost:5000/api/clients/audit-log', { params });
      setAuditLog(res.data.data);
      setAuditTotalPages(res.data.totalPages);
      setAuditTotal(res.data.total);
    } catch (err) {
      console.error('Failed to load audit log');
    } finally {
      setAuditLoading(false);
    }
  }, [auditPage, auditRecordFilter]);

  useEffect(() => { fetchClients(); }, [fetchClients]);
  useEffect(() => { if (showAuditLog) fetchAuditLog(); }, [fetchAuditLog, showAuditLog]);

  // Auto-clear success message
  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(''), 3000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  // ===== EDIT =====
  const startEdit = (client) => {
    setEditingId(client.Id);
    const values = {};
    ALL_FIELDS.forEach(f => { values[f.key] = client[f.key] || ''; });
    setEditValues(values);
    setOriginalValues({ ...values });
    // Expand the row so detail fields are visible for editing
    setExpandedRows(prev => ({ ...prev, [client.Id]: true }));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({});
    setOriginalValues({});
  };

  const toggleExpand = (id) => {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const saveEdit = async () => {
    const changes = {};
    ALL_FIELDS.forEach(f => {
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
      await axios.put(`http://localhost:5000/api/clients/${editingId}`, {
        updates: changes,
        changedBy: userLabel,
      });
      cancelEdit();
      setSuccessMsg('Record updated successfully.');
      fetchClients();
    } catch (err) {
      setError('Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleFieldChange = (key, value) => {
    setEditValues(prev => ({ ...prev, [key]: value }));
  };

  // ===== ADD NEW =====
  const handleNewRowChange = (key, value) => {
    setNewRow(prev => ({ ...prev, [key]: value }));
  };

  const saveNewRow = async () => {
    if (!newRow.ClientID && !newRow.BusinessName) {
      setError('At least Client ID or Business Name is required.');
      return;
    }

    setAddingSaving(true);
    setError('');
    try {
      await axios.post('http://localhost:5000/api/clients', {
        client: newRow,
        createdBy: userLabel,
      });
      setShowAddRow(false);
      setNewRow(emptyRow());
      setSuccessMsg('New record added successfully.');
      fetchClients();
    } catch (err) {
      setError('Failed to add new record.');
    } finally {
      setAddingSaving(false);
    }
  };

  const cancelAddRow = () => {
    setShowAddRow(false);
    setNewRow(emptyRow());
  };

  // ===== DELETE =====
  const confirmDelete = (client) => {
    setDeleteConfirm(client);
  };

  const executeDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await axios.delete(`http://localhost:5000/api/clients/${deleteConfirm.Id}`, {
        data: { deletedBy: userLabel },
      });
      setDeleteConfirm(null);
      setSuccessMsg(`"${deleteConfirm.BusinessName}" deleted.`);
      fetchClients();
    } catch (err) {
      setError('Failed to delete record.');
      setDeleteConfirm(null);
    }
  };

  // ===== INVITE =====
  const openInviteModal = (client) => {
    if (!client.Email) {
      setError('This client has no email address on file. Add an email first.');
      return;
    }
    setInviteModal(client);
    setInviteRole('Company Admin');
  };

  const sendInvite = async () => {
    if (!inviteModal) return;
    setInviteSending(true);
    setError('');
    try {
      const res = await axios.post('http://localhost:5000/api/invites', {
        clientRecordId: inviteModal.Id,
        role: inviteRole,
        invitedBy: userLabel,
      });
      setInviteModal(null);
      setSuccessMsg(res.data.message);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send invitation.');
    } finally {
      setInviteSending(false);
    }
  };

  // ===== SEND EPV =====
  const sendEPV = async (client) => {
    if (!client.Email) {
      setError('This client has no email address. Add an email first.');
      return;
    }
    setEpvSending(client.Id);
    setError('');
    try {
      const res = await axios.post('http://localhost:5000/api/epv/send', {
        clientRecordId: client.Id,
        sentBy: userLabel,
      });
      setSuccessMsg(res.data.message);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send EPV.');
    } finally {
      setEpvSending(null);
    }
  };

  // ===== MISC =====
  const viewRecordHistory = (recordId) => {
    setAuditRecordFilter(String(recordId));
    setAuditPage(1);
    setShowAuditLog(true);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleString();
  };

  return (
    <div className="page-container client-allocation-page">
      <div className="page-card">
        <div className="ca-header">
          <div>
            <h2>Consolidated Master Abattoir Database</h2>
            <p className="ca-subtitle">{total.toLocaleString()} records</p>
          </div>
          <div className="ca-header-actions">
            {!showAuditLog && (
              <button
                className="ca-add-btn"
                onClick={() => { setShowAddRow(true); setEditingId(null); }}
                disabled={showAddRow}
              >
                + Add New
              </button>
            )}
            <button
              className={`ca-toggle-btn ${showAuditLog ? 'active' : ''}`}
              onClick={() => { setShowAuditLog(!showAuditLog); setAuditRecordFilter(''); setAuditPage(1); }}
            >
              {showAuditLog ? 'Show Data' : 'Change Log'}
            </button>
            {!showAuditLog && (
              <form onSubmit={handleSearch} className="ca-search-form">
                <input
                  type="text"
                  placeholder="Search by name, ID, email, town..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="ca-search-input"
                />
                <button type="submit" className="ca-search-btn">Search</button>
              </form>
            )}
          </div>
        </div>

        {error && <p className="ca-error">{error}</p>}
        {successMsg && <p className="ca-success">{successMsg}</p>}

        {/* ===== DELETE CONFIRMATION MODAL ===== */}
        {deleteConfirm && (
          <div className="ca-modal-overlay">
            <div className="ca-modal">
              <h3>Confirm Delete</h3>
              <p>Are you sure you want to delete this record?</p>
              <div className="ca-modal-record">
                <strong>{deleteConfirm.ClientID}</strong> — {deleteConfirm.BusinessName}
              </div>
              <p className="ca-modal-warning">This action cannot be undone.</p>
              <div className="ca-modal-actions">
                <button className="ca-delete-confirm-btn" onClick={executeDelete}>Yes, Delete</button>
                <button className="ca-cancel-btn" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* ===== INVITE MODAL ===== */}
        {inviteModal && (
          <div className="ca-modal-overlay">
            <div className="ca-modal">
              <h3>Send Invitation</h3>
              <p>Send an invite to join EPVS:</p>
              <div className="ca-modal-record">
                <strong>{inviteModal.BusinessName}</strong><br />
                <span style={{ color: '#6b7280', fontSize: 13 }}>{inviteModal.Email}</span>
              </div>
              <div className="ca-invite-role-select">
                <label>Invite as:</label>
                <div className="ca-invite-role-options">
                  <button
                    className={`ca-invite-role-btn ${inviteRole === 'Company Admin' ? 'active' : ''}`}
                    onClick={() => setInviteRole('Company Admin')}
                  >
                    <strong>Company Admin</strong>
                    <span>Will verify business details</span>
                  </button>
                  <button
                    className={`ca-invite-role-btn ${inviteRole === 'User' ? 'active' : ''}`}
                    onClick={() => setInviteRole('User')}
                  >
                    <strong>User</strong>
                    <span>View-only access</span>
                  </button>
                </div>
              </div>
              <div className="ca-modal-actions">
                <button className="ca-invite-send-btn" onClick={sendInvite} disabled={inviteSending}>
                  {inviteSending ? 'Sending...' : 'Send Invitation'}
                </button>
                <button className="ca-cancel-btn" onClick={() => setInviteModal(null)} disabled={inviteSending}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {showAuditLog ? (
          /* ===== AUDIT LOG VIEW ===== */
          <div>
            <div className="ca-audit-header">
              <h3>Change Log {auditRecordFilter && <span className="ca-audit-filter">— Filtered by Record #{auditRecordFilter}</span>}</h3>
              <p className="ca-subtitle">{auditTotal} change(s) recorded</p>
              {auditRecordFilter && (
                <button className="ca-clear-filter" onClick={() => { setAuditRecordFilter(''); setAuditPage(1); }}>
                  Clear Filter
                </button>
              )}
            </div>
            <div className="ca-table-wrapper">
              <table className="ca-table ca-audit-table">
                <thead>
                  <tr>
                    <th>Date/Time</th>
                    <th>Client ID</th>
                    <th>Business Name</th>
                    <th>Field Changed</th>
                    <th>Old Value</th>
                    <th>New Value</th>
                    <th>Changed By</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLoading ? (
                    <tr><td colSpan="7" className="ca-loading">Loading...</td></tr>
                  ) : auditLog.length === 0 ? (
                    <tr><td colSpan="7" className="ca-loading">No changes recorded yet.</td></tr>
                  ) : (
                    auditLog.map((entry) => (
                      <tr key={entry.Id}>
                        <td className="ca-date-cell">{formatDate(entry.ChangedAt)}</td>
                        <td>{entry.ClientID || '—'}</td>
                        <td>{entry.BusinessName || '—'}</td>
                        <td><span className={`ca-field-badge ${entry.FieldName === '_CREATED' ? 'ca-badge-created' : ''} ${entry.FieldName === '_DELETED' ? 'ca-badge-deleted' : ''} ${entry.FieldName === '_VERIFIED' ? 'ca-badge-verified' : ''}`}>{entry.FieldName}</span></td>
                        <td className="ca-old-value">{entry.OldValue}</td>
                        <td className="ca-new-value">{entry.NewValue}</td>
                        <td>{entry.ChangedBy}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {auditTotalPages > 1 && (
              <div className="ca-pagination">
                <button onClick={() => setAuditPage(p => Math.max(1, p - 1))} disabled={auditPage === 1} className="ca-page-btn">Previous</button>
                <span className="ca-page-info">Page {auditPage} of {auditTotalPages}</span>
                <button onClick={() => setAuditPage(p => Math.min(auditTotalPages, p + 1))} disabled={auditPage === auditTotalPages} className="ca-page-btn">Next</button>
              </div>
            )}
          </div>
        ) : (
          /* ===== DATA TABLE VIEW ===== */
          <div>
            <div className="ca-table-wrapper">
              <table className="ca-table">
                <thead>
                  <tr>
                    <th className="ca-actions-col">Actions</th>
                    <th className="ca-status-col">Status</th>
                    {TABLE_FIELDS.map(f => <th key={f.key}>{f.label}</th>)}
                    <th className="ca-details-col">Facility Contact Details</th>
                    <th className="ca-invite-col"></th>
                  </tr>
                </thead>
                <tbody>
                  {/* ===== ADD NEW ROW ===== */}
                  {showAddRow && (
                    <>
                      <tr className="ca-adding-row">
                        <td className="ca-actions-cell">
                          <div className="ca-edit-actions">
                            <button className="ca-save-btn" onClick={saveNewRow} disabled={addingSaving}>
                              {addingSaving ? '...' : 'Add'}
                            </button>
                            <button className="ca-cancel-btn" onClick={cancelAddRow} disabled={addingSaving}>Cancel</button>
                          </div>
                        </td>
                        <td></td>
                        {TABLE_FIELDS.map(f => (
                          <td key={f.key}>
                            {f.key === 'FacilityProvince' ? (
                              <select
                                className="ca-edit-input ca-new-input"
                                value={newRow[f.key]}
                                onChange={(e) => handleNewRowChange(f.key, e.target.value)}
                              >
                                <option value="">— Select —</option>
                                {['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'].map(p => (
                                  <option key={p} value={p}>{p}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                className="ca-edit-input ca-new-input"
                                placeholder={f.label}
                                value={newRow[f.key]}
                                onChange={(e) => handleNewRowChange(f.key, e.target.value)}
                              />
                            )}
                          </td>
                        ))}
                        <td className="ca-details-cell">
                          <button className="ca-expand-btn active" disabled>Contacts ▼</button>
                        </td>
                        <td className="ca-invite-cell"></td>
                      </tr>
                      {/* Detail fields for new row */}
                      <tr className="ca-adding-row ca-detail-row">
                        <td colSpan={TABLE_FIELDS.length + 4}>
                          <div className="ca-detail-groups">
                            {DETAIL_GROUPS.map(group => (
                              <div key={group.key} className="ca-detail-group">
                                <div className="ca-detail-group-title">{group.label}</div>
                                <div className="ca-detail-group-fields">
                                  {group.fields.map(f => (
                                    <div key={f.key} className="ca-detail-field">
                                      <label>{f.label}</label>
                                      <input
                                        type="text"
                                        className="ca-edit-input ca-new-input"
                                        placeholder={f.label}
                                        value={newRow[f.key]}
                                        onChange={(e) => handleNewRowChange(f.key, e.target.value)}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    </>
                  )}
                  {loading ? (
                    <tr><td colSpan={TABLE_FIELDS.length + 4} className="ca-loading">Loading...</td></tr>
                  ) : clients.length === 0 ? (
                    <tr><td colSpan={TABLE_FIELDS.length + 4} className="ca-loading">No records found.</td></tr>
                  ) : (
                    clients.map((c) => (
                      <React.Fragment key={c.Id}>
                        <tr className={editingId === c.Id ? 'ca-editing-row' : ''}>
                          <td className="ca-actions-cell">
                            {editingId === c.Id ? (
                              <div className="ca-edit-actions">
                                <button className="ca-save-btn" onClick={saveEdit} disabled={saving}>
                                  {saving ? '...' : 'Save'}
                                </button>
                                <button className="ca-cancel-btn" onClick={cancelEdit} disabled={saving}>Cancel</button>
                              </div>
                            ) : (
                              <div className="ca-edit-actions">
                                <button className="ca-edit-btn" onClick={() => startEdit(c)} disabled={editingId !== null || showAddRow}>Edit</button>
                                <button className="ca-history-btn" onClick={() => viewRecordHistory(c.Id)} title="View change history">Hist</button>
                                <button className="ca-delete-btn" onClick={() => confirmDelete(c)} disabled={editingId !== null || showAddRow} title="Delete record">Del</button>
                              </div>
                            )}
                          </td>
                          <td className="ca-status-cell">
                            {c.VerifiedAt ? (
                              <span className="ca-verified-badge" title={`Verified by ${c.VerifiedBy || 'Unknown'} on ${new Date(c.VerifiedAt).toLocaleDateString()}`}>Verified</span>
                            ) : (
                              <span className="ca-unverified-badge">Pending</span>
                            )}
                            {c.EPVCycleStatus && (
                              <span className="ca-epv-cycle-badge" title="Client is on monthly EPV cycle">{c.EPVCycleStatus}</span>
                            )}
                          </td>
                          {TABLE_FIELDS.map(f => (
                            <td key={f.key}>
                              {editingId === c.Id && !f.readOnly ? (
                                f.key === 'FacilityProvince' ? (
                                  <select
                                    className={`ca-edit-input ${editValues[f.key] !== originalValues[f.key] ? 'ca-changed' : ''}`}
                                    value={editValues[f.key]}
                                    onChange={(e) => handleFieldChange(f.key, e.target.value)}
                                  >
                                    <option value="">— Select —</option>
                                    {['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'].map(p => (
                                      <option key={p} value={p}>{p}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    type="text"
                                    className={`ca-edit-input ${editValues[f.key] !== originalValues[f.key] ? 'ca-changed' : ''}`}
                                    value={editValues[f.key]}
                                    onChange={(e) => handleFieldChange(f.key, e.target.value)}
                                  />
                                )
                              ) : (
                                c[f.key]
                              )}
                            </td>
                          ))}
                          <td className="ca-details-cell">
                            <button
                              className={`ca-expand-btn ${expandedRows[c.Id] ? 'active' : ''}`}
                              onClick={() => toggleExpand(c.Id)}
                            >
                              {expandedRows[c.Id] ? 'Hide ▲' : 'View ▼'}
                            </button>
                          </td>
                          <td className="ca-invite-cell">
                            <button className="ca-invite-btn" onClick={() => openInviteModal(c)} disabled={editingId !== null || showAddRow} title="Send invitation">Invite</button>
                            <button
                              className="ca-epv-btn"
                              onClick={() => sendEPV(c)}
                              disabled={editingId !== null || showAddRow || epvSending === c.Id}
                              title="Send Egg Production Verification"
                            >
                              {epvSending === c.Id ? 'Sending...' : 'Send EPV'}
                            </button>
                          </td>
                        </tr>
                        {/* Expandable detail row */}
                        {expandedRows[c.Id] && (
                          <tr className={`ca-detail-row ${editingId === c.Id ? 'ca-editing-row' : ''}`}>
                            <td colSpan={TABLE_FIELDS.length + 4}>
                              <div className="ca-detail-groups">
                                {DETAIL_GROUPS.map(group => (
                                  <div key={group.key} className="ca-detail-group">
                                    <div className="ca-detail-group-title">{group.label}</div>
                                    <div className="ca-detail-group-fields">
                                      {group.fields.map(f => (
                                        <div key={f.key} className="ca-detail-field">
                                          <label>{f.label}</label>
                                          {editingId === c.Id ? (
                                            <input
                                              type="text"
                                              className={`ca-edit-input ${editValues[f.key] !== originalValues[f.key] ? 'ca-changed' : ''}`}
                                              value={editValues[f.key]}
                                              onChange={(e) => handleFieldChange(f.key, e.target.value)}
                                            />
                                          ) : (
                                            <span className="ca-detail-value">{c[f.key] || '—'}</span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="ca-pagination">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="ca-page-btn">Previous</button>
                <span className="ca-page-info">Page {page} of {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="ca-page-btn">Next</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ClientAllocation;
