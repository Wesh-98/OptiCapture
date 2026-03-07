/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Scan from './pages/Scan';
import Import from './pages/Import';
import Logs from './pages/Logs';

import MobileScan from './pages/MobileScan';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) return <div className="min-h-screen flex items-center justify-center bg-slate-50">Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/mobile-scan/:sessionId" element={<MobileScan />} />
          <Route path="/" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } />
          <Route path="/scan" element={
            <ProtectedRoute>
              <Scan />
            </ProtectedRoute>
          } />
          <Route path="/import" element={
            <ProtectedRoute>
              <Import />
            </ProtectedRoute>
          } />
          <Route path="/logs" element={
            <ProtectedRoute>
              <Logs />
            </ProtectedRoute>
          } />
        </Routes>
      </AuthProvider>
    </Router>
  );
}
