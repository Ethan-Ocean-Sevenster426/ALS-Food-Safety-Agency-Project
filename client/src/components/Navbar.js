import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import './Navbar.css';

function Navbar() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isCompanyUser = user.role === 'Company Admin' || user.role === 'User';

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <header className="navbar">
      <div className="navbar-top">
        <h1 className="navbar-brand">EPVS</h1>
        <nav className="navbar-links">
          {isCompanyUser ? (
            <>
              <NavLink to="/company">Company Overview</NavLink>
              <NavLink to="/settings">Settings</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/dashboard" end>Dashboard</NavLink>
              <NavLink to="/production">Production</NavLink>
              <NavLink to="/inventory">Inventory</NavLink>
              <NavLink to="/reports">Reports</NavLink>
              <NavLink to="/clients">Clients</NavLink>
              <NavLink to="/company">Company Overview</NavLink>
              <NavLink to="/settings">Settings</NavLink>
            </>
          )}
        </nav>
        <div className="navbar-user">
          <span className="navbar-username">{user.firstName || 'User'}</span>
          <span className="navbar-role">{user.role || 'User'}</span>
          <button onClick={handleLogout} className="navbar-logout">Sign Out</button>
        </div>
      </div>
    </header>
  );
}

export default Navbar;
