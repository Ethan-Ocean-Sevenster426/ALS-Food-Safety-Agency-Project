import React from 'react';
import './PageStyles.css';

function Settings() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  return (
    <div className="page-container">
      <div className="page-card">
        <h2>Settings</h2>
        <div className="settings-info">
          <div className="settings-row">
            <span className="settings-label">Name</span>
            <span>{user.firstName} {user.lastName}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Email</span>
            <span>{user.email}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
