import React from 'react';
import './axiosConfig'; // JWT auth interceptor - must be first
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Production from './pages/Production';
import Inventory from './pages/Inventory';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import ClientAllocation from './pages/ClientAllocation';
import CompanyOverview from './pages/CompanyOverview';
import ResetPassword from './pages/ResetPassword';
import AcceptInvite from './pages/AcceptInvite';
import EPVForm from './pages/EPVForm';
import Support from './pages/Support';
import Inspectors from './pages/Inspectors';
import Administrators from './pages/Administrators';
import CompanyRegister from './pages/CompanyRegister';
import SuperCollections from './pages/SuperCollections';
import AppLayout from './components/AppLayout';

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" />;
}

function AdminRoute({ children }) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (user.role === 'Company Admin' || user.role === 'User') {
    return <Navigate to="/company" />;
  }
  if (user.role === 'Inspector') {
    return <Navigate to="/inspectors" />;
  }
  return children;
}

function InspectorRoute({ children }) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (user.role === 'Company Admin' || user.role === 'User') {
    return <Navigate to="/company" />;
  }
  return children;
}

// Only the 3rd-party ALS collectors (role 'ALS' or legacy 'Super') and Super Admins may view.
function ALSRoute({ children }) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (user.role === 'ALS' || user.role === 'Super' || user.role === 'Super Admin') return children;
  return <Navigate to="/company" />;
}

function DefaultRedirect() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (user.role === 'Company Admin' || user.role === 'User') {
    return <Navigate to="/company" />;
  }
  if (user.role === 'Inspector') {
    return <Navigate to="/inspectors" />;
  }
  if (user.role === 'ALS' || user.role === 'Super') {
    return <Navigate to="/als" />;
  }
  return <Navigate to="/dashboard" />;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/register" element={<CompanyRegister />} />
        <Route path="/accept-invite/:token" element={<AcceptInvite />} />
        <Route path="/reset-password/:token" element={<ResetPassword />} />
        <Route path="/epv/:token" element={<EPVForm />} />
        <Route
          element={
            <PrivateRoute>
              <AppLayout />
            </PrivateRoute>
          }
        >
          <Route path="/dashboard" element={<AdminRoute><Dashboard /></AdminRoute>} />
          <Route path="/production" element={<Production />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/clients" element={<AdminRoute><ClientAllocation /></AdminRoute>} />
          <Route path="/inspectors" element={<InspectorRoute><Inspectors /></InspectorRoute>} />
          <Route path="/administrators" element={<AdminRoute><Administrators /></AdminRoute>} />
          <Route path="/company" element={<CompanyOverview />} />
          <Route path="/als"   element={<ALSRoute><SuperCollections /></ALSRoute>} />
          <Route path="/super" element={<Navigate to="/als" replace />} />
          <Route path="/support" element={<Support />} />
        </Route>
        <Route path="*" element={<PrivateRoute><DefaultRedirect /></PrivateRoute>} />
      </Routes>
    </Router>
  );
}

export default App;
