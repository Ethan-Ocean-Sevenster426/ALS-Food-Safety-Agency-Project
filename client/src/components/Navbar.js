import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import './Navbar.css';

function Navbar() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isCompanyUser = user.role === 'Company Admin' || user.role === 'User';
  const isInspector = user.role === 'Inspector';
  const showInspectorsTab = user.role === 'Super Admin' || user.role === 'Admin' || user.role === 'Inspector';
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="navbar">
      <div className="navbar-top">
        <div className="navbar-brand"><img src="/fsa-logo.png" alt="FSA" className="navbar-logo" /><span>EPVS</span></div>
        <button className="navbar-hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
          <span className={`hamburger-line ${menuOpen ? 'open' : ''}`} />
          <span className={`hamburger-line ${menuOpen ? 'open' : ''}`} />
          <span className={`hamburger-line ${menuOpen ? 'open' : ''}`} />
        </button>
        <nav className={`navbar-links ${menuOpen ? 'navbar-links-open' : ''}`}>
          {isCompanyUser ? (
            <>
              <NavLink to="/company" onClick={closeMenu}>Company Overview</NavLink>
              <NavLink to="/support" onClick={closeMenu}>Support</NavLink>
              <NavLink to="/settings" onClick={closeMenu}>User Management</NavLink>
            </>
          ) : isInspector ? (
            <>
              <NavLink to="/inspectors" onClick={closeMenu}>Inspectors</NavLink>
              <NavLink to="/company" onClick={closeMenu}>Company Overview</NavLink>
              <NavLink to="/support" onClick={closeMenu}>Support</NavLink>
              <NavLink to="/settings" onClick={closeMenu}>User Management</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/dashboard" end onClick={closeMenu}>Dashboard</NavLink>
              <NavLink to="/clients" onClick={closeMenu}>Clients</NavLink>
              <NavLink to="/inspectors" onClick={closeMenu}>Inspectors</NavLink>
              <NavLink to="/administrators" onClick={closeMenu}>Administrators</NavLink>
              <NavLink to="/company" onClick={closeMenu}>Company Overview</NavLink>
              <NavLink to="/support" onClick={closeMenu}>Support</NavLink>
              <NavLink to="/settings" onClick={closeMenu}>User Management</NavLink>
            </>
          )}
          <div className="navbar-user-mobile">
            <span className="navbar-username">{user.firstName || 'User'}</span>
            <span className="navbar-role">{user.role || 'User'}</span>
            <button onClick={handleLogout} className="navbar-logout">Sign Out</button>
          </div>
        </nav>
        <div className="navbar-user navbar-user-desktop">
          <span className="navbar-username">{user.firstName || 'User'}</span>
          <span className="navbar-role">{user.role || 'User'}</span>
          <button onClick={handleLogout} className="navbar-logout">Sign Out</button>
        </div>
      </div>
      {menuOpen && <div className="navbar-overlay" onClick={closeMenu} />}
    </header>
  );
}

export default Navbar;
