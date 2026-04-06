import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, ScanLine, Upload, History, LogOut, Menu, X, ChevronRight, Store, Settings, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, logout, myStores, switchStore } = useAuth();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [storeSwitcherOpen, setStoreSwitcherOpen] = useState(false);
  const storeSwitcherRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (storeSwitcherRef.current && !storeSwitcherRef.current.contains(e.target as Node)) {
        setStoreSwitcherOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!user) return <>{children}</>;

  const allNavItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/scan', label: 'Scan', icon: ScanLine },
    { href: '/import', label: 'Import', icon: Upload, ownerOnly: true },
    { href: '/logs', label: 'Activity Logs', icon: History },
    { href: '/settings', label: 'Store Settings', icon: Settings },
  ];
  const navItems = allNavItems.filter(item => !item.ownerOnly || user?.role !== 'taker');

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
          className="absolute -right-3.5 top-20 bg-navy-700 text-white p-1.5 rounded-full shadow-lg border-2 border-navy-800 hover:bg-navy-600 transition-all duration-200 z-10"
          title={isSidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
        >
          <ChevronRight size={16} className={cn("transition-transform duration-300", !isSidebarCollapsed && "rotate-180")} />
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
        <header className="bg-navy-900 border-b border-navy-800 h-16 flex items-center justify-between px-4 md:px-8 z-20">
          <div className="flex items-center gap-4 md:hidden">
            <div className="w-8 h-8 bg-white rounded-md flex items-center justify-center text-navy-900 font-bold">OC</div>
            <h1 className="text-lg font-bold text-white">OptiCapture</h1>
          </div>

          {myStores && myStores.length > 1 ? (
            <div ref={storeSwitcherRef} className="relative">
              <button
                onClick={() => setStoreSwitcherOpen(o => !o)}
                className="hidden md:flex items-center gap-2 text-white font-medium bg-navy-800 px-4 py-2 rounded-full hover:bg-navy-700 transition-colors"
              >
                {user.store_logo
                  ? <img src={user.store_logo} alt={user.store_name} className="w-7 h-7 rounded-full object-cover border border-navy-700" />
                  : <Store size={18} className="text-slate-400" />
                }
                <span>{user.store_name}</span>
                <ChevronDown size={14} className={cn("text-slate-400 transition-transform", storeSwitcherOpen && "rotate-180")} />
              </button>

              {storeSwitcherOpen && (
                <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50">
                  <p className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">Your Stores</p>
                  {myStores.map(store => (
                    <button
                      key={store.id}
                      onClick={async () => {
                        setStoreSwitcherOpen(false);
                        await switchStore(store.id);
                        globalThis.location.reload();
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left",
                        store.name === user.store_name && "bg-slate-50"
                      )}
                    >
                      {store.logo
                        ? <img src={store.logo} alt={store.name} className="w-8 h-8 rounded-lg object-cover border border-slate-200 flex-shrink-0" />
                        : <div className="w-8 h-8 rounded-lg bg-navy-100 flex items-center justify-center text-navy-700 font-bold text-sm flex-shrink-0">{store.name.charAt(0)}</div>
                      }
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{store.name}</p>
                        <p className="text-xs text-slate-400 capitalize">{store.role}</p>
                      </div>
                      {store.name === user.store_name && (
                        <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-2 text-white font-medium bg-navy-800 px-4 py-2 rounded-full">
              {user.store_logo
                ? <img src={user.store_logo} alt={user.store_name} className="w-7 h-7 rounded-full object-cover border border-navy-700" />
                : <Store size={18} className="text-slate-400" />
              }
              <span>{user.store_name}</span>
            </div>
          )}

          <div className="flex items-center gap-4">
            <div className="md:hidden">
              <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 text-white">
                {isMobileMenuOpen ? <X /> : <Menu />}
              </button>
            </div>
            <div className="hidden md:flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-bold text-white">{user.username}</p>
                <p className="text-xs text-slate-400 capitalize">{user.role}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-navy-800 flex items-center justify-center text-white font-bold border border-navy-700">
                {user.username[0].toUpperCase()}
              </div>
            </div>
          </div>
        </header>

        {/* Mobile Menu */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
              animate={prefersReducedMotion ? {} : { height: 'auto', opacity: 1 }}
              exit={prefersReducedMotion ? {} : { height: 0, opacity: 0 }}
              className="md:hidden bg-navy-900 text-slate-300 overflow-hidden absolute top-16 left-0 right-0 z-50 shadow-xl"
            >
              <nav className="p-4 space-y-2">
                <div className="pb-4 mb-4 border-b border-navy-800">
                  <p className="text-sm text-slate-500 mb-1">Current Store</p>
                  <div className="flex items-center gap-2 text-white font-medium">
                    {user.store_logo
                      ? <img src={user.store_logo} alt={user.store_name} className="w-7 h-7 rounded-full object-cover border border-white" />
                      : <Store size={18} />
                    }
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
        <main className="flex-1 overflow-auto bg-slate-100 p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
