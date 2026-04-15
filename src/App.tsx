/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const SuperAdmin = lazy(() => import('./pages/SuperAdmin'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const MobileScan = lazy(() => import('./pages/MobileScan'));
const StoreSettings = lazy(() => import('./pages/StoreSettings'));

// Heavy pages — lazy-loaded so they don't bloat the initial bundle
const Scan = lazy(() => import('./pages/Scan'));
const Import = lazy(() => import('./pages/Import'));
const Logs = lazy(() => import('./pages/Logs'));

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 text-sm">
      Loading...
    </div>
  );
}

function ContentLoader() {
  return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
      Loading...
    </div>
  );
}

interface ErrorBoundaryState { hasError: boolean; error: Error | null; }

class ErrorBoundary extends React.Component<Readonly<{ children: React.ReactNode }>, ErrorBoundaryState> {
  constructor(props: Readonly<{ children: React.ReactNode }>) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-md w-full text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <span className="text-red-600 text-2xl">!</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Something went wrong</h2>
            <p className="text-slate-500 text-sm mb-6">An unexpected error occurred. Please reload the page — your data is safe.</p>
            <button
              onClick={() => globalThis.location.reload()}
              className="px-5 py-2.5 bg-navy-900 text-white rounded-xl text-sm font-semibold hover:bg-navy-800 transition-colors"
            >
              Reload Page
            </button>
            {import.meta.env.DEV && this.state.error && (
              <pre className="mt-4 text-left text-xs bg-slate-100 rounded-lg p-3 text-red-600 overflow-auto max-h-32">
                {this.state.error.message}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ProtectedRoute({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" />;
  if (user.role === 'superadmin') return <Navigate to="/admin" replace />;
  if (user.must_reset_password && location.pathname !== '/settings') {
    return <Navigate to="/settings" replace />;
  }

  return (
    <Layout>
      <Suspense fallback={<ContentLoader />}>{children}</Suspense>
    </Layout>
  );
}

function AdminRoute({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" />;
  if (user.role !== 'superadmin') return <Navigate to="/" replace />;

  return <Suspense fallback={<FullPageLoader />}>{children}</Suspense>;
}

//Route definitions are all declared here in one place for easy overview and to avoid circular imports between pages/layout.
export default function App() {
  return (
    <ErrorBoundary>
      <Router>
        <AuthProvider>
          <Routes>
            <Route
              path="/login"
              element={
                <Suspense fallback={<FullPageLoader />}>
                  <Login />
                </Suspense>
              }
            />
            <Route
              path="/signup"
              element={
                <Suspense fallback={<FullPageLoader />}>
                  <Signup />
                </Suspense>
              }
            />
            <Route path="/admin" element={
              <AdminRoute>
                <SuperAdmin />
              </AdminRoute>
            } />
            <Route
              path="/mobile-scan/:sessionId"
              element={
                <Suspense fallback={<FullPageLoader />}>
                  <MobileScan />
                </Suspense>
              }
            />
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
            <Route path="/settings" element={
              <ProtectedRoute>
                <StoreSettings />
              </ProtectedRoute>
            } />
          </Routes>
        </AuthProvider>
      </Router>
    </ErrorBoundary>
  );
}
