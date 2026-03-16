import React from 'react';
import './PageStyles.css';

function Dashboard() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  return (
    <div className="page-container">
      <div className="page-card">
        <h2>Dashboard</h2>
        <p>
          Welcome back, {user.firstName} {user.lastName}! You are now signed in.
        </p>
      </div>
    </div>
  );
}

export default Dashboard;
