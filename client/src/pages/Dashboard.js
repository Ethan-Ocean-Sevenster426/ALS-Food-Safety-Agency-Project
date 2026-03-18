import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './PageStyles.css';
import './Dashboard.css';

function Dashboard() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('http://localhost:5000/api/dashboard/stats')
      .then(res => setStats(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString();
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

  if (loading) {
    return (
      <div className="page-container dash-page">
        <div className="page-card"><p style={{ color: '#888', textAlign: 'center', padding: 30 }}>Loading dashboard...</p></div>
      </div>
    );
  }

  return (
    <div className="page-container dash-page">
      {/* Welcome */}
      <div className="page-card dash-welcome">
        <div className="dash-welcome-text">
          <h2>Welcome back, {user.firstName}!</h2>
          <p>Here's an overview of your EPVS system.</p>
        </div>
        <span className="dash-role-badge">{user.role}</span>
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

            <div className="dash-stat-card">
              <div className="dash-stat-icon dash-stat-epv">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              </div>
              <div className="dash-stat-content">
                <span className="dash-stat-number">{stats.epv.total}</span>
                <span className="dash-stat-label">EPV Forms</span>
                <span className="dash-stat-sub">{stats.epv.pending} pending</span>
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

          {/* Secondary Stats Row */}
          <div className="dash-secondary-grid">
            <div className="page-card dash-breakdown-card">
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

            <div className="page-card dash-breakdown-card">
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

            <div className="page-card dash-breakdown-card">
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

          {/* Recent Activity */}
          <div className="dash-recent-grid">
            <div className="page-card dash-recent-card">
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

            <div className="page-card dash-recent-card">
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
        </>
      )}
    </div>
  );
}

export default Dashboard;
