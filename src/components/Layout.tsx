import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, ScanLine, Upload, History, LogOut, Menu, X, ChevronRight, Store, Box } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);

  if (!user) return <>{children}</>;

  const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/scan', label: 'Mobile Scan', icon: ScanLine },
    { href: '/import', label: 'Import', icon: Upload },
    { href: '/logs', label: 'Activity Logs', icon: History },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside 
        className={cn(
          "hidden md:flex flex-col bg-navy-900 text-slate-400 border-r border-navy-800 transition-all duration-300 relative",
          isSidebarCollapsed ? "w-20" : "w-64"
        )}
      >
        <div className="p-4 border-b border-navy-800 flex items-center justify-center h-16">
          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-navy-900 font-bold text-xl shadow-lg">
            OC
          </div>
          {!isSidebarCollapsed && (
            <div className="ml-3 overflow-hidden whitespace-nowrap">
              <h1 className="text-lg font-bold text-white tracking-tight">OptiCapture</h1>
            </div>
          )}
        </div>

        <button 
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="absolute -right-3 top-20 bg-slate-200 text-slate-600 p-1 rounded-full shadow-md hover:bg-white transition-colors z-10"
        >
          <ChevronRight size={14} className={cn("transition-transform", !isSidebarCollapsed && "rotate-180")} />
        </button>
        
        <nav className="flex-1 p-2 space-y-2 mt-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200 group relative",
                  isActive 
                    ? "bg-navy-800 text-white shadow-lg shadow-navy-900/50" 
                    : "hover:bg-navy-800/50 hover:text-slate-200",
                  isSidebarCollapsed ? "justify-center" : ""
                )}
                title={isSidebarCollapsed ? item.label : undefined}
              >
                <Icon size={24} className={cn(isActive ? "text-white" : "text-slate-400 group-hover:text-white")} />
                {!isSidebarCollapsed && <span className="font-medium whitespace-nowrap">{item.label}</span>}
                
                {isActive && (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-slate-400 rounded-l-full" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-navy-800">
          <button
            onClick={logout}
            className={cn(
              "flex items-center gap-3 text-sm text-red-400 hover:bg-navy-800 rounded-lg transition-colors p-2",
              isSidebarCollapsed ? "justify-center" : "w-full"
            )}
            title="Sign Out"
          >
            <LogOut size={20} />
            {!isSidebarCollapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Header */}
        <header className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-4 md:px-8 shadow-sm z-20">
          <div className="flex items-center gap-4 md:hidden">
            <div className="w-8 h-8 bg-navy-900 rounded-md flex items-center justify-center text-white font-bold">OC</div>
            <h1 className="text-lg font-bold text-navy-900">OptiCapture</h1>
          </div>

          <div className="hidden md:flex items-center gap-2 text-navy-900 font-medium bg-slate-100 px-4 py-2 rounded-full">
            <Store size={18} className="text-slate-500" />
            <span>{user.store_name}</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="md:hidden">
              <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 text-navy-900">
                {isMobileMenuOpen ? <X /> : <Menu />}
              </button>
            </div>
            <div className="hidden md:flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-bold text-navy-900">{user.username}</p>
                <p className="text-xs text-slate-500 capitalize">{user.role}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-navy-100 flex items-center justify-center text-navy-700 font-bold border border-navy-200">
                {user.username[0].toUpperCase()}
              </div>
            </div>
          </div>
        </header>

        {/* Mobile Menu */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="md:hidden bg-navy-900 text-slate-300 overflow-hidden absolute top-16 left-0 right-0 z-50 shadow-xl"
            >
              <nav className="p-4 space-y-2">
                <div className="pb-4 mb-4 border-b border-navy-800">
                  <p className="text-sm text-slate-500 mb-1">Current Store</p>
                  <div className="flex items-center gap-2 text-white font-medium">
                    <Store size={18} />
                    <span>{user.store_name}</span>
                  </div>
                </div>
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-lg",
                      location.pathname === item.href ? "bg-navy-800 text-white" : "hover:bg-navy-800/50"
                    )}
                  >
                    <item.icon size={20} />
                    {item.label}
                  </Link>
                ))}
                <button
                  onClick={() => {
                    logout();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-navy-800/50 rounded-lg mt-4"
                >
                  <LogOut size={20} />
                  Sign Out
                </button>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <main className="flex-1 overflow-auto bg-slate-50 p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
