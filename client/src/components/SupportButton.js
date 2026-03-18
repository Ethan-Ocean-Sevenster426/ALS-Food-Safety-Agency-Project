import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './SupportButton.css';

function SupportButton() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      axios.get('http://localhost:5000/api/support/categories')
        .then(res => setCategories(res.data.categories || []))
        .catch(() => setCategories([]));
    }
  }, [open]);

  const resetForm = () => {
    setCategoryId('');
    setSubject('');
    setDescription('');
    setPriority('Medium');
    setError('');
    setSuccess('');
  };

  const handleClose = () => {
    setOpen(false);
    resetForm();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!categoryId || !subject) {
      setError('Please select a category and enter a subject.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await axios.post('http://localhost:5000/api/support/tickets', {
        categoryId: parseInt(categoryId),
        subject,
        description,
        priority,
        userId: user.id,
        clientRecordId: user.clientRecordId || null,
      });
      setSuccess('Ticket submitted successfully!');
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit ticket.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button className="support-fab" onClick={() => setOpen(true)} title="Log a Support Ticket">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>Support</span>
      </button>

      {open && (
        <div className="support-modal-overlay" onClick={handleClose}>
          <div className="support-modal" onClick={(e) => e.stopPropagation()}>
            <div className="support-modal-header">
              <h3>Log a Support Ticket</h3>
              <button className="support-modal-close" onClick={handleClose}>&times;</button>
            </div>

            {success ? (
              <div className="support-success">{success}</div>
            ) : (
              <form onSubmit={handleSubmit} className="support-form">
                {error && <div className="support-error">{error}</div>}

                <div className="support-field">
                  <label>Issue Type <span className="support-required">*</span></label>
                  <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                    <option value="">Select issue type...</option>
                    {categories.map(c => (
                      <option key={c.Id} value={c.Id}>{c.Name}</option>
                    ))}
                  </select>
                </div>

                <div className="support-field">
                  <label>Subject <span className="support-required">*</span></label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Brief summary of the issue"
                    required
                  />
                </div>

                <div className="support-field">
                  <label>Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the issue in detail..."
                    rows={4}
                  />
                </div>

                <div className="support-field">
                  <label>Priority</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>

                <button type="submit" className="support-submit-btn" disabled={submitting}>
                  {submitting ? 'Submitting...' : 'Submit Ticket'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default SupportButton;
