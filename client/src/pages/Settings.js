import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import './PageStyles.css';
import './Settings.css';

const ROLES = ['Super Admin', 'Admin', 'Company Admin', 'User'];

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
  const [editData, setEditData] = useState({ firstName: '', lastName: '', email: '', role: 'User' });
  const [editSubmitting, setEditSubmitting] = useState(false);

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const res = await axios.get('http://localhost:5000/api/auth/users');
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
      await axios.put(`http://localhost:5000/api/auth/users/${userId}/role`, { role: newRole });
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
      await axios.delete(`http://localhost:5000/api/auth/users/${deleteConfirm.Id}`);
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

  const executeDeactivate = async () => {
    if (!deactivateConfirm) return;
    const newStatus = !deactivateConfirm.IsActive;
    try {
      await axios.put(`http://localhost:5000/api/auth/users/${deactivateConfirm.Id}/deactivate`, {
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

  const openEditModal = (u) => {
    setEditData({
      firstName: u.FirstName,
      lastName: u.LastName,
      email: u.Email,
      role: u.Role,
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
      await axios.put(`http://localhost:5000/api/auth/users/${editModal.Id}`, editData);
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
          <h2>All Users</h2>
          <p className="settings-subtitle">Manage all user accounts, roles, and access.</p>

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
                      onChange={(e) => setEditData({ ...editData, role: e.target.value })}
                      className="settings-edit-select"
                    >
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
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

          <div className="settings-table-wrapper">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Company</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="7" className="settings-loading">Loading...</td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan="7" className="settings-loading">No users found.</td></tr>
                ) : (
                  users.map((u) => (
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
                        {u.AllocatedClient ? (
                          <span className="settings-allocation">
                            {u.AllocatedClient}
                            <span className="settings-client-id">{u.AllocatedClientID}</span>
                          </span>
                        ) : (
                          <span className="settings-no-allocation">—</span>
                        )}
                      </td>
                      <td className="settings-date">{formatDate(u.CreatedAt)}</td>
                      <td className="settings-actions-cell">
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
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default Settings;
