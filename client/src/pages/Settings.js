import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import './PageStyles.css';
import './Settings.css';

const ROLES = ['Super Admin', 'Admin', 'Inspector', 'Company Admin', 'User'];

const SA_PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
  'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape',
];

function Settings() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isAdmin = user.role === 'Super Admin' || user.role === 'Admin';

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [resetModal, setResetModal] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [deactivateConfirm, setDeactivateConfirm] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [editData, setEditData] = useState({ firstName: '', lastName: '', email: '', role: 'User', inspectorProvince: '' });
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [addUserModal, setAddUserModal] = useState(false);
  const [addUserData, setAddUserData] = useState({ firstName: '', lastName: '', email: '', password: '', role: 'User', inspectorProvince: '', clientRecordId: '' });
  const [addUserSubmitting, setAddUserSubmitting] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [companySearch, setCompanySearch] = useState('');
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const [loginLogOpen, setLoginLogOpen] = useState(false);
  const [loginLog, setLoginLog] = useState([]);
  const [loginLogLoading, setLoginLogLoading] = useState(false);
  const [loginLogSearch, setLoginLogSearch] = useState('');
  const [loginLogSuccessFilter, setLoginLogSuccessFilter] = useState('');

  const fetchLoginLog = useCallback(async () => {
    setLoginLogLoading(true);
    try {
      const params = { limit: 200 };
      if (loginLogSearch) params.search = loginLogSearch;
      if (loginLogSuccessFilter) params.success = loginLogSuccessFilter;
      const res = await axios.get('/api/auth/login-log', { params });
      setLoginLog(res.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load login log.');
    } finally {
      setLoginLogLoading(false);
    }
  }, [loginLogSearch, loginLogSuccessFilter]);

  const openLoginLog = () => {
    setLoginLogOpen(true);
    fetchLoginLog();
  };

  useEffect(() => {
    if (loginLogOpen) fetchLoginLog();
  }, [loginLogOpen, loginLogSearch, loginLogSuccessFilter, fetchLoginLog]);

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const res = await axios.get('/api/auth/users');
      setUsers(res.data.users);
    } catch (err) {
      setError('Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(''), 3000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  const handleRoleChange = async (userId, newRole) => {
    try {
      await axios.put(`/api/auth/users/${userId}/role`, { role: newRole });
      setSuccessMsg('Role updated.');
      if (userId === user.id) {
        const updated = { ...user, role: newRole };
        localStorage.setItem('user', JSON.stringify(updated));
      }
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update role.');
    }
  };

  const executeDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await axios.delete(`/api/auth/users/${deleteConfirm.Id}`);
      setDeleteConfirm(null);
      setSuccessMsg(`User "${deleteConfirm.FirstName} ${deleteConfirm.LastName}" deleted.`);
      fetchUsers();
    } catch (err) {
      setError('Failed to delete user.');
      setDeleteConfirm(null);
    }
  };

  const executeResetPassword = async () => {
    if (!resetModal || !resetPassword) return;
    if (resetPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setResetting(true);
    setError('');
    try {
      await axios.put(`/api/auth/users/${resetModal.Id}/reset-password`, {
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

  const executeDeactivate = async () => {
    if (!deactivateConfirm) return;
    const newStatus = !deactivateConfirm.IsActive;
    try {
      await axios.put(`/api/auth/users/${deactivateConfirm.Id}/deactivate`, {
        isActive: newStatus,
      });
      setDeactivateConfirm(null);
      setSuccessMsg(`User "${deactivateConfirm.FirstName} ${deactivateConfirm.LastName}" ${newStatus ? 'activated' : 'deactivated'}.`);
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update user status.');
      setDeactivateConfirm(null);
    }
  };

  const fetchCompanies = useCallback(async (search) => {
    setCompaniesLoading(true);
    try {
      const res = await axios.get(`/api/clients?limit=20&search=${encodeURIComponent(search)}`);
      setCompanies(res.data.clients || res.data.data || []);
    } catch {
      setCompanies([]);
    } finally {
      setCompaniesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (addUserModal && (addUserData.role === 'Company Admin' || addUserData.role === 'User')) {
      const timer = setTimeout(() => fetchCompanies(companySearch), 300);
      return () => clearTimeout(timer);
    }
  }, [companySearch, addUserModal, addUserData.role, fetchCompanies]);

  const executeAddUser = async () => {
    const { firstName, lastName, email, password, role, inspectorProvince, clientRecordId } = addUserData;
    if (!firstName || !lastName || !email || !password) {
      setError('All fields are required.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (role === 'Inspector' && !inspectorProvince) {
      setError('Please select at least one province for the inspector.');
      return;
    }
    if ((role === 'Company Admin' || role === 'User') && !clientRecordId) {
      setError('Please select a company to link this user to.');
      return;
    }
    setAddUserSubmitting(true);
    setError('');
    try {
      await axios.post('/api/auth/signup', {
        firstName,
        lastName,
        email,
        password,
        role,
        inspectorProvince: role === 'Inspector' ? inspectorProvince : undefined,
        clientRecordId: (role === 'Company Admin' || role === 'User') ? clientRecordId : undefined,
      });
      setAddUserModal(false);
      setAddUserData({ firstName: '', lastName: '', email: '', password: '', role: 'User', inspectorProvince: '', clientRecordId: '' });
      setCompanySearch('');
      setSuccessMsg(`${role} "${firstName} ${lastName}" added successfully.`);
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add user.');
    } finally {
      setAddUserSubmitting(false);
    }
  };

  const openEditModal = (u) => {
    setEditData({
      firstName: u.FirstName,
      lastName: u.LastName,
      email: u.Email,
      role: u.Role,
      inspectorProvince: u.InspectorProvince || '',
    });
    setEditModal(u);
    setError('');
  };

  const executeEdit = async () => {
    if (!editModal) return;
    if (!editData.firstName || !editData.lastName || !editData.email) {
      setError('All fields are required.');
      return;
    }
    setEditSubmitting(true);
    setError('');
    try {
      await axios.put(`/api/auth/users/${editModal.Id}`, editData);
      setEditModal(null);
      setSuccessMsg(`User "${editData.firstName} ${editData.lastName}" updated.`);
      // Update localStorage if editing self
      if (editModal.Id === user.id) {
        const updated = { ...user, firstName: editData.firstName, lastName: editData.lastName, email: editData.email, role: editData.role };
        localStorage.setItem('user', JSON.stringify(updated));
      }
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update user.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString();
  };

  const getRoleBadgeClass = (role) => {
    switch (role) {
      case 'Super Admin': return 'role-super-admin';
      case 'Admin': return 'role-admin';
      case 'Inspector': return 'role-inspector';
      case 'Company Admin': return 'role-company-admin';
      default: return 'role-user';
    }
  };

  return (
    <div className="page-container settings-page">
      <div className="page-card">
        <h2>User Management</h2>
        <div className="settings-info">
          <div className="settings-row">
            <span className="settings-label">Name</span>
            <span>{user.firstName} {user.lastName}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Email</span>
            <span>{user.email}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Role</span>
            <span className={`role-badge ${getRoleBadgeClass(user.role)}`}>{user.role || 'User'}</span>
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="page-card" style={{ marginTop: 20 }}>
          <div className="settings-header-row">
            <div>
              <h2 style={{ margin: 0 }}>All Users</h2>
              <p className="settings-subtitle" style={{ margin: '4px 0 0' }}>Manage all user accounts, roles, and access.</p>
            </div>
            {user.role === 'Super Admin' && (
              <button
                className="settings-add-user-btn"
                onClick={() => { setAddUserModal(true); setError(''); setCompanySearch(''); setCompanies([]); }}
              >
                + Add User
              </button>
            )}
          </div>

          {error && <p className="settings-error">{error}</p>}
          {successMsg && <p className="settings-success">{successMsg}</p>}

          {/* Delete Confirmation Modal */}
          {deleteConfirm && (
            <div className="settings-modal-overlay">
              <div className="settings-modal">
                <h3>Delete User</h3>
                <p>Are you sure you want to delete this user?</p>
                <div className="settings-modal-record">
                  <strong>{deleteConfirm.FirstName} {deleteConfirm.LastName}</strong><br />
                  {deleteConfirm.Email} — {deleteConfirm.Role}
                </div>
                <p className="settings-modal-warning">This action cannot be undone.</p>
                <div className="settings-modal-actions">
                  <button className="settings-delete-confirm" onClick={executeDelete}>Yes, Delete</button>
                  <button className="settings-cancel-btn" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* Reset Password Modal */}
          {resetModal && (
            <div className="settings-modal-overlay">
              <div className="settings-modal">
                <h3 style={{ color: '#0E7C7B' }}>Reset Password</h3>
                <p>Set a new password for:</p>
                <div className="settings-modal-record">
                  <strong>{resetModal.FirstName} {resetModal.LastName}</strong><br />
                  {resetModal.Email}
                </div>
                <div style={{ margin: '16px 0' }}>
                  <input
                    type="password"
                    placeholder="New password (min 6 characters)"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    className="settings-reset-input"
                  />
                </div>
                <div className="settings-modal-actions">
                  <button className="settings-reset-confirm" onClick={executeResetPassword} disabled={resetting || resetPassword.length < 6}>
                    {resetting ? 'Resetting...' : 'Reset Password'}
                  </button>
                  <button className="settings-cancel-btn" onClick={() => { setResetModal(null); setResetPassword(''); }} disabled={resetting}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* Deactivate Confirmation Modal */}
          {deactivateConfirm && (
            <div className="settings-modal-overlay">
              <div className="settings-modal">
                <h3 style={{ color: deactivateConfirm.IsActive ? '#d97706' : '#16a34a' }}>
                  {deactivateConfirm.IsActive ? 'Deactivate User' : 'Activate User'}
                </h3>
                <p>
                  {deactivateConfirm.IsActive
                    ? 'This user will no longer be able to log in.'
                    : 'This user will be able to log in again.'}
                </p>
                <div className="settings-modal-record">
                  <strong>{deactivateConfirm.FirstName} {deactivateConfirm.LastName}</strong><br />
                  {deactivateConfirm.Email} — {deactivateConfirm.Role}
                </div>
                <div className="settings-modal-actions">
                  <button
                    className={deactivateConfirm.IsActive ? 'settings-deactivate-confirm' : 'settings-activate-confirm'}
                    onClick={executeDeactivate}
                  >
                    {deactivateConfirm.IsActive ? 'Yes, Deactivate' : 'Yes, Activate'}
                  </button>
                  <button className="settings-cancel-btn" onClick={() => setDeactivateConfirm(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* Edit User Modal */}
          {editModal && (
            <div className="settings-modal-overlay">
              <div className="settings-modal">
                <h3 style={{ color: '#0E7C7B' }}>Edit User</h3>
                <div className="settings-edit-form">
                  <div className="settings-edit-row">
                    <label>First Name</label>
                    <input
                      type="text"
                      value={editData.firstName}
                      onChange={(e) => setEditData({ ...editData, firstName: e.target.value })}
                      className="settings-reset-input"
                    />
                  </div>
                  <div className="settings-edit-row">
                    <label>Last Name</label>
                    <input
                      type="text"
                      value={editData.lastName}
                      onChange={(e) => setEditData({ ...editData, lastName: e.target.value })}
                      className="settings-reset-input"
                    />
                  </div>
                  <div className="settings-edit-row">
                    <label>Email</label>
                    <input
                      type="email"
                      value={editData.email}
                      onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                      className="settings-reset-input"
                    />
                  </div>
                  <div className="settings-edit-row">
                    <label>Role</label>
                    <select
                      value={editData.role}
                      onChange={(e) => setEditData({ ...editData, role: e.target.value, inspectorProvince: e.target.value === 'Inspector' ? editData.inspectorProvince : '' })}
                      className="settings-edit-select"
                    >
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  {editData.role === 'Inspector' && (
                    <div className="settings-edit-row">
                      <label>Allocated Provinces</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {SA_PROVINCES.map(p => {
                          const selected = (editData.inspectorProvince || '').split(',').map(s => s.trim()).filter(Boolean);
                          const isChecked = selected.includes(p);
                          return (
                            <label key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 4, border: isChecked ? '2px solid #0E7C7B' : '1px solid #d1d5db', background: isChecked ? '#e6f7f7' : '#fff', cursor: 'pointer', fontSize: 13, fontWeight: isChecked ? 600 : 400, color: isChecked ? '#0E7C7B' : '#374151' }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  const current = (editData.inspectorProvince || '').split(',').map(s => s.trim()).filter(Boolean);
                                  const updated = isChecked ? current.filter(x => x !== p) : [...current, p];
                                  setEditData({ ...editData, inspectorProvince: updated.join(', ') });
                                }}
                                style={{ display: 'none' }}
                              />
                              {p}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                <div className="settings-modal-actions">
                  <button className="settings-reset-confirm" onClick={executeEdit} disabled={editSubmitting}>
                    {editSubmitting ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button className="settings-cancel-btn" onClick={() => setEditModal(null)} disabled={editSubmitting}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* Add User Modal */}
          {addUserModal && (
            <div className="settings-modal-overlay">
              <div className="settings-modal settings-modal-wide">
                <h3 style={{ color: '#0E7C7B' }}>Add User</h3>
                <p>Create a new user account.</p>
                <div className="settings-edit-form">
                  <div className="settings-add-row-group">
                    <div className="settings-edit-row">
                      <label>First Name</label>
                      <input
                        type="text"
                        value={addUserData.firstName}
                        onChange={(e) => setAddUserData({ ...addUserData, firstName: e.target.value })}
                        className="settings-reset-input"
                        placeholder="First name"
                      />
                    </div>
                    <div className="settings-edit-row">
                      <label>Last Name</label>
                      <input
                        type="text"
                        value={addUserData.lastName}
                        onChange={(e) => setAddUserData({ ...addUserData, lastName: e.target.value })}
                        className="settings-reset-input"
                        placeholder="Last name"
                      />
                    </div>
                  </div>
                  <div className="settings-edit-row">
                    <label>Email</label>
                    <input
                      type="email"
                      value={addUserData.email}
                      onChange={(e) => setAddUserData({ ...addUserData, email: e.target.value })}
                      className="settings-reset-input"
                      placeholder="Email address"
                    />
                  </div>
                  <div className="settings-edit-row">
                    <label>Password</label>
                    <input
                      type="password"
                      value={addUserData.password}
                      onChange={(e) => setAddUserData({ ...addUserData, password: e.target.value })}
                      className="settings-reset-input"
                      placeholder="Min 6 characters"
                    />
                  </div>
                  <div className="settings-edit-row">
                    <label>Role</label>
                    <select
                      value={addUserData.role}
                      onChange={(e) => setAddUserData({ ...addUserData, role: e.target.value, inspectorProvince: '', clientRecordId: '' })}
                      className="settings-edit-select"
                    >
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>

                  {/* Inspector: Province selector */}
                  {addUserData.role === 'Inspector' && (
                    <div className="settings-edit-row">
                      <label>Allocated Provinces</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {SA_PROVINCES.map(p => {
                          const selected = (addUserData.inspectorProvince || '').split(',').map(s => s.trim()).filter(Boolean);
                          const isChecked = selected.includes(p);
                          return (
                            <label key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 4, border: isChecked ? '2px solid #0E7C7B' : '1px solid #d1d5db', background: isChecked ? '#e6f7f7' : '#fff', cursor: 'pointer', fontSize: 13, fontWeight: isChecked ? 600 : 400, color: isChecked ? '#0E7C7B' : '#374151' }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  const current = (addUserData.inspectorProvince || '').split(',').map(s => s.trim()).filter(Boolean);
                                  const updated = isChecked ? current.filter(x => x !== p) : [...current, p];
                                  setAddUserData({ ...addUserData, inspectorProvince: updated.join(', ') });
                                }}
                                style={{ display: 'none' }}
                              />
                              {p}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Company Admin / User: Company selector */}
                  {(addUserData.role === 'Company Admin' || addUserData.role === 'User') && (
                    <div className="settings-edit-row">
                      <label>Link to Company</label>
                      <input
                        type="text"
                        value={companySearch}
                        onChange={(e) => setCompanySearch(e.target.value)}
                        className="settings-reset-input"
                        placeholder="Search company by name, ID, or town..."
                      />
                      <div className="settings-company-list">
                        {companiesLoading ? (
                          <div className="settings-company-loading">Searching...</div>
                        ) : companies.length === 0 ? (
                          <div className="settings-company-loading">{companySearch ? 'No companies found.' : 'Type to search companies...'}</div>
                        ) : (
                          companies.map(c => (
                            <div
                              key={c.Id}
                              className={`settings-company-item ${addUserData.clientRecordId === c.Id ? 'selected' : ''}`}
                              onClick={() => setAddUserData({ ...addUserData, clientRecordId: c.Id })}
                            >
                              <strong>{c.BusinessName}</strong>
                              <span className="settings-company-meta">{c.Town ? c.Town : ''} {c.FacilityProvince ? `(${c.FacilityProvince})` : ''}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="settings-modal-actions">
                  <button className="settings-add-user-confirm" onClick={executeAddUser} disabled={addUserSubmitting}>
                    {addUserSubmitting ? 'Adding...' : 'Add User'}
                  </button>
                  <button className="settings-cancel-btn" onClick={() => setAddUserModal(false)} disabled={addUserSubmitting}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* Search & Filter */}
          <div className="settings-search-row">
            <input
              className="settings-search-input"
              placeholder="Search by name, email, or company..."
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
            />
            <select className="settings-role-filter" value={userRoleFilter} onChange={e => setUserRoleFilter(e.target.value)}>
              <option value="">All Roles</option>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {(userSearch || userRoleFilter) && (
              <button className="settings-search-clear" onClick={() => { setUserSearch(''); setUserRoleFilter(''); }}>Clear</button>
            )}
            {isAdmin && (
              <button className="settings-search-clear" onClick={openLoginLog} title="View login attempts" style={{ background: '#0E7C7B', color: '#fff' }}>
                Login History
              </button>
            )}
            <span className="settings-user-count">{users.filter(u => {
              const s = userSearch.toLowerCase();
              const matchesSearch = !s || `${u.FirstName} ${u.LastName}`.toLowerCase().includes(s) || (u.Email || '').toLowerCase().includes(s) || (u.AllocatedClient || '').toLowerCase().includes(s);
              const matchesRole = !userRoleFilter || u.Role === userRoleFilter;
              return matchesSearch && matchesRole;
            }).length} of {users.length} users</span>
          </div>

          <div className="settings-table-wrapper">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Province</th>
                  <th>Company</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const s = userSearch.toLowerCase();
                  const filtered = users.filter(u => {
                    const matchesSearch = !s || `${u.FirstName} ${u.LastName}`.toLowerCase().includes(s) || (u.Email || '').toLowerCase().includes(s) || (u.AllocatedClient || '').toLowerCase().includes(s);
                    const matchesRole = !userRoleFilter || u.Role === userRoleFilter;
                    return matchesSearch && matchesRole;
                  });
                  return loading ? (
                  <tr><td colSpan="8" className="settings-loading">Loading...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan="8" className="settings-loading">No users found.</td></tr>
                ) : (
                  filtered.map((u) => (
                    <tr key={u.Id} className={u.IsActive === false || u.IsActive === 0 ? 'user-inactive-row' : ''}>
                      <td>{u.FirstName} {u.LastName}</td>
                      <td>{u.Email}</td>
                      <td>
                        <select
                          value={u.Role}
                          onChange={(e) => handleRoleChange(u.Id, e.target.value)}
                          className={`role-select ${getRoleBadgeClass(u.Role)}`}
                          disabled={u.Id === user.id && user.role !== 'Super Admin'}
                        >
                          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </td>
                      <td>
                        <span className={`status-badge ${u.IsActive === false || u.IsActive === 0 ? 'status-inactive' : 'status-active'}`}>
                          {u.IsActive === false || u.IsActive === 0 ? 'Inactive' : 'Active'}
                        </span>
                      </td>
                      <td>
                        {u.Role === 'Inspector' && u.InspectorProvince ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {u.InspectorProvince.split(',').map(p => p.trim()).filter(Boolean).map(p => (
                              <span key={p} className="settings-province-badge">{p}</span>
                            ))}
                          </div>
                        ) : u.Role === 'Inspector' ? (
                          <span className="settings-no-allocation" style={{ color: '#dc2626' }}>Not Assigned</span>
                        ) : (
                          <span className="settings-no-allocation">—</span>
                        )}
                      </td>
                      <td>
                        {u.AllocatedClient ? (
                          <span className="settings-allocation">
                            {u.AllocatedClient}
                          </span>
                        ) : (
                          <span className="settings-no-allocation">—</span>
                        )}
                      </td>
                      <td className="settings-date">{formatDate(u.CreatedAt)}</td>
                      <td>
                        <div className="settings-actions-cell">
                          <button
                            className="settings-edit-btn"
                            onClick={() => openEditModal(u)}
                            title="Edit user"
                          >
                            Edit
                          </button>
                          {user.role === 'Super Admin' && (
                            <button
                              className="settings-reset-btn"
                              onClick={() => { setResetModal(u); setResetPassword(''); }}
                              title="Reset password"
                            >
                              Reset PW
                            </button>
                          )}
                          <button
                            className={u.IsActive === false || u.IsActive === 0 ? 'settings-activate-btn' : 'settings-deactivate-btn'}
                            onClick={() => setDeactivateConfirm(u)}
                            disabled={u.Id === user.id}
                            title={u.Id === user.id ? "Can't deactivate yourself" : (u.IsActive ? 'Deactivate user' : 'Activate user')}
                          >
                            {u.IsActive === false || u.IsActive === 0 ? 'Activate' : 'Deactivate'}
                          </button>
                          <button
                            className="settings-delete-btn"
                            onClick={() => setDeleteConfirm(u)}
                            disabled={u.Id === user.id}
                            title={u.Id === user.id ? "Can't delete yourself" : 'Delete user'}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                );
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loginLogOpen && (
        <div className="settings-modal-overlay" onClick={() => setLoginLogOpen(false)}>
          <div
            className="settings-modal"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: 1100, width: '90%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
          >
            <h3 style={{ marginTop: 0, color: '#0E7C7B' }}>Login History</h3>
            <p style={{ color: '#666', marginTop: 0 }}>
              Every login attempt is recorded here (successful and failed).
            </p>

            <div style={{ display: 'flex', gap: 8, margin: '10px 0', alignItems: 'center' }}>
              <input
                className="settings-search-input"
                placeholder="Search by name or email..."
                value={loginLogSearch}
                onChange={e => setLoginLogSearch(e.target.value)}
                style={{ flex: 1 }}
              />
              <select
                className="settings-role-filter"
                value={loginLogSuccessFilter}
                onChange={e => setLoginLogSuccessFilter(e.target.value)}
              >
                <option value="">All attempts</option>
                <option value="true">Successful only</option>
                <option value="false">Failed only</option>
              </select>
              <button className="settings-search-clear" onClick={() => { setLoginLogSearch(''); setLoginLogSuccessFilter(''); }}>
                Clear
              </button>
            </div>

            <div style={{ overflow: 'auto', flex: 1, border: '1px solid #e5e7eb', borderRadius: 6 }}>
              <table className="settings-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Outcome</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {loginLogLoading ? (
                    <tr><td colSpan="6" style={{ padding: 20, textAlign: 'center' }}>Loading...</td></tr>
                  ) : loginLog.length === 0 ? (
                    <tr><td colSpan="6" style={{ padding: 20, textAlign: 'center', color: '#888' }}>No matching login attempts.</td></tr>
                  ) : loginLog.map(row => (
                    <tr key={row.Id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(row.LoggedInAt).toLocaleString()}</td>
                      <td>{row.FirstName ? `${row.FirstName} ${row.LastName}` : <span style={{ color: '#888' }}>(unknown)</span>}</td>
                      <td>{row.Email}</td>
                      <td>{row.Role || '—'}</td>
                      <td>
                        {row.Success
                          ? <span style={{ color: '#15803d', fontWeight: 600 }}>Success</span>
                          : <span style={{ color: '#dc2626', fontWeight: 600 }} title={row.Reason || ''}>Failed{row.Reason ? ` — ${row.Reason}` : ''}</span>}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{row.IPAddress || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="settings-cancel-btn" onClick={() => setLoginLogOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Settings;
