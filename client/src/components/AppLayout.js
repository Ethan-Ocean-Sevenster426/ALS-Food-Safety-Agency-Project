import React from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import SupportButton from './SupportButton';
function AppLayout() {
  return (
    <div className="app-layout">
      <Navbar />
      <main className="app-content">
        <Outlet />
      </main>
      <SupportButton />
    </div>
  );
}

export default AppLayout;
