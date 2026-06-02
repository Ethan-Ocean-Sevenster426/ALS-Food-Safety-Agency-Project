import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import './PageStyles.css';
import './Support.css';

const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

function Support() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isSuper = user.role === 'Super Admin';
  const isAdmin = user.role === 'Admin' || user.role === 'Super';
  const canManage = isSuper || isAdmin;

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterType, setFilterType] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Detail view
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketDetail, setTicketDetail] = useState(null);
  const [comments, setComments] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [commenting, setCommenting] = useState(false);

  // Admin list for assignment
  const [adminUsers, setAdminUsers] = useState([]);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/support/tickets', {
        params: {
          userId: user.id,
          role: user.role,
          clientRecordId: user.clientRecordId || '',
        },
      });
      setTickets(res.data.tickets);
    } catch (err) {
      setError('Failed to load tickets.');
    } finally {
      setLoading(false);
    }
  }, [user.id, user.role, user.clientRecordId]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  useEffect(() => {
    if (canManage) {
      axios.get('/api/auth/users')
        .then(res => {
          const admins = res.data.users.filter(u =>
            u.Role === 'Super Admin' || u.Role === 'Admin'
          );
          setAdminUsers(admins);
        })
        .catch(() => {});
    }
  }, [canManage]);

  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(''), 3000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  const openTicketDetail = async (ticket) => {
    setSelectedTicket(ticket);
    setDetailLoading(true);
    setNewComment('');
    try {
      const res = await axios.get(`/api/support/tickets/${ticket.Id}`);
      setTicketDetail(res.data.ticket);
      setComments(res.data.comments);
    } catch (err) {
      setError('Failed to load ticket details.');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedTicket(null);
    setTicketDetail(null);
    setComments([]);
  };

  const updateTicket = async (field, value) => {
    if (!ticketDetail) return;
    try {
      await axios.put(`/api/support/tickets/${ticketDetail.Id}`, {
        [field]: value,
      });
      setTicketDetail(prev => ({ ...prev, [field === 'assignedToUserId' ? 'AssignedToUserId' : field.charAt(0).toUpperCase() + field.slice(1)]: value }));
      setSuccessMsg('Ticket updated.');
      fetchTickets();
    } catch (err) {
      setError('Failed to update ticket.');
    }
  };

  const addComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    setCommenting(true);
    try {
      await axios.post(`/api/support/tickets/${ticketDetail.Id}/comments`, {
        userId: user.id,
        comment: newComment,
      });
      setNewComment('');
      // Refresh comments
      const res = await axios.get(`/api/support/tickets/${ticketDetail.Id}`);
      setComments(res.data.comments);
      setTicketDetail(res.data.ticket);
    } catch (err) {
      setError('Failed to add comment.');
    } finally {
      setCommenting(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleString();
  };

  const filteredTickets = tickets.filter(t => {
    if (filterStatus && t.Status !== filterStatus) return false;
    if (filterPriority && t.Priority !== filterPriority) return false;
    if (filterType && t.CategoryType !== filterType) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return (t.Subject || '').toLowerCase().includes(s)
        || (t.CategoryName || '').toLowerCase().includes(s)
        || (t.CreatedByName || '').toLowerCase().includes(s)
        || (`#${t.Id}`).includes(s);
    }
    return true;
  });

  const getPriorityClass = (p) => {
    switch (p) {
      case 'Urgent': return 'priority-urgent';
      case 'High': return 'priority-high';
      case 'Medium': return 'priority-medium';
      default: return 'priority-low';
    }
  };

  const getStatusClass = (s) => {
    switch (s) {
      case 'Open': return 'status-open';
      case 'In Progress': return 'status-in-progress';
      case 'Resolved': return 'status-resolved';
      case 'Closed': return 'status-closed';
      default: return '';
    }
  };

  // ===== TICKET DETAIL VIEW =====
  if (selectedTicket) {
    return (
      <div className="page-container support-page">
        <button className="support-back-btn" onClick={closeDetail}>&larr; Back to Tickets</button>

        {error && <p className="support-error-msg">{error}</p>}
        {successMsg && <p className="support-success-msg">{successMsg}</p>}

        {detailLoading ? (
          <div className="page-card"><p className="support-loading">Loading ticket...</p></div>
        ) : ticketDetail && (
          <>
            <div className="page-card support-detail-card">
              <div className="support-detail-header">
                <div>
                  <span className="support-ticket-id">#{ticketDetail.Id}</span>
                  <h2>{ticketDetail.Subject}</h2>
                </div>
                <div className="support-detail-badges">
                  <span className={`support-priority-badge ${getPriorityClass(ticketDetail.Priority)}`}>{ticketDetail.Priority}</span>
                  <span className={`support-status-badge ${getStatusClass(ticketDetail.Status)}`}>{ticketDetail.Status}</span>
                </div>
              </div>

              <div className="support-detail-meta">
                <div className="support-meta-item">
                  <label>Category</label>
                  <span>
                    <span className={`support-type-badge support-type-${ticketDetail.CategoryType.toLowerCase()}`}>{ticketDetail.CategoryType}</span>
                    {ticketDetail.CategoryName}
                  </span>
                </div>
                <div className="support-meta-item">
                  <label>Created By</label>
                  <span>{ticketDetail.CreatedByName} ({ticketDetail.CreatedByEmail})</span>
                </div>
                {ticketDetail.CompanyName && (
                  <div className="support-meta-item">
                    <label>Company</label>
                    <span>{ticketDetail.CompanyName}</span>
                  </div>
                )}
                <div className="support-meta-item">
                  <label>Created</label>
                  <span>{formatDate(ticketDetail.CreatedAt)}</span>
                </div>
                <div className="support-meta-item">
                  <label>Last Updated</label>
                  <span>{formatDate(ticketDetail.UpdatedAt)}</span>
                </div>
              </div>

              {ticketDetail.Description && (
                <div className="support-detail-description">
                  <label>Description</label>
                  <p>{ticketDetail.Description}</p>
                </div>
              )}

              {/* Admin Controls */}
              {canManage && (
                <div className="support-admin-controls">
                  <div className="support-control">
                    <label>Status</label>
                    <select
                      value={ticketDetail.Status}
                      onChange={(e) => updateTicket('status', e.target.value)}
                    >
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="support-control">
                    <label>Priority</label>
                    <select
                      value={ticketDetail.Priority}
                      onChange={(e) => updateTicket('priority', e.target.value)}
                    >
                      {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="support-control">
                    <label>Assign To</label>
                    <select
                      value={ticketDetail.AssignedToUserId || ''}
                      onChange={(e) => updateTicket('assignedToUserId', e.target.value ? parseInt(e.target.value) : null)}
                    >
                      <option value="">Unassigned</option>
                      {adminUsers.map(a => (
                        <option key={a.Id} value={a.Id}>{a.FirstName} {a.LastName} ({a.Role})</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Comments */}
            <div className="page-card support-comments-card">
              <h3>Comments ({comments.length})</h3>

              {comments.length === 0 ? (
                <p className="support-loading">No comments yet.</p>
              ) : (
                <div className="support-comments-list">
                  {comments.map(c => (
                    <div key={c.Id} className="support-comment">
                      <div className="support-comment-header">
                        <strong>{c.UserName}</strong>
                        <span className="support-comment-role">{c.UserRole}</span>
                        <span className="support-comment-date">{formatDate(c.CreatedAt)}</span>
                      </div>
                      <p>{c.Comment}</p>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={addComment} className="support-comment-form">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Add a comment..."
                  rows={3}
                  required
                />
                <button type="submit" disabled={commenting || !newComment.trim()}>
                  {commenting ? 'Posting...' : 'Post Comment'}
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    );
  }

  // ===== TICKET LIST VIEW =====
  return (
    <div className="page-container support-page">
      <div className="page-card">
        <h2>Support Tickets</h2>
        <p className="support-subtitle">
          {isSuper ? 'All tickets across the system.' :
           isAdmin ? 'Administration tickets.' :
           'Your company\'s support tickets.'}
        </p>

        {error && <p className="support-error-msg">{error}</p>}
        {successMsg && <p className="support-success-msg">{successMsg}</p>}

        {/* Filters */}
        <div className="support-filters">
          <input
            type="text"
            placeholder="Search tickets..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="support-search"
          />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="support-filter-select">
            <option value="">All Statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className="support-filter-select">
            <option value="">All Priorities</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {(isSuper) && (
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="support-filter-select">
              <option value="">All Types</option>
              <option value="IT">IT Support</option>
              <option value="Administration">Administration</option>
            </select>
          )}
        </div>

        {/* Table */}
        <div className="support-table-wrapper">
          <table className="support-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Subject</th>
                <th>Category</th>
                <th>Type</th>
                <th>Priority</th>
                <th>Status</th>
                {canManage && <th>Company</th>}
                <th>Created By</th>
                <th>Assigned To</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canManage ? 10 : 9} className="support-loading">Loading...</td></tr>
              ) : filteredTickets.length === 0 ? (
                <tr><td colSpan={canManage ? 10 : 9} className="support-loading">No tickets found.</td></tr>
              ) : (
                filteredTickets.map(t => (
                  <tr key={t.Id} className="support-ticket-row" onClick={() => openTicketDetail(t)}>
                    <td className="support-id">#{t.Id}</td>
                    <td className="support-subject">{t.Subject}</td>
                    <td>{t.CategoryName}</td>
                    <td>
                      <span className={`support-type-badge support-type-${t.CategoryType.toLowerCase()}`}>
                        {t.CategoryType}
                      </span>
                    </td>
                    <td>
                      <span className={`support-priority-badge ${getPriorityClass(t.Priority)}`}>
                        {t.Priority}
                      </span>
                    </td>
                    <td>
                      <span className={`support-status-badge ${getStatusClass(t.Status)}`}>
                        {t.Status}
                      </span>
                    </td>
                    {canManage && <td>{t.CompanyName || '—'}</td>}
                    <td>{t.CreatedByName}</td>
                    <td>{t.AssignedToName || '—'}</td>
                    <td className="support-date">{formatDate(t.CreatedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Support;
