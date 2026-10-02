import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ScanLine,
  Upload,
  Download,
  History,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Store,
  Settings,
  ChevronDown,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, logout, leaveCurrentStore, myStores, switchStore, activeStoreId } = useAuth();
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
  const hasForcedReset = user.must_reset_password;
  const hasMultipleStores = myStores.length > 1;
  const resolvedActiveStoreId = activeStoreId ?? user.store_id;
  const currentStoreLabel = user.store_name ?? 'Store';

  const allNavItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/scan', label: 'Scan', icon: ScanLine },
    { href: '/import', label: 'Import', icon: Upload, ownerOnly: true },
    {
      href: '/?export=1',
      label: 'Export',
      icon: Download,
      ownerOnly: true,
      activeSearch: 'export=1',
    },
    { href: '/logs', label: 'Activity Logs', icon: History },
    { href: '/settings', label: 'Store Settings', icon: Settings },
  ];
  const navItems = allNavItems.filter(item => {
    if (hasForcedReset) {
      return item.href === '/settings';
    }

    return !item.ownerOnly || user.role !== 'taker';
  });
  const searchParams = new URLSearchParams(location.search);
  const isExportRouteActive = searchParams.get('export') === '1';
  const hasExportNavItem = navItems.some(item => item.activeSearch === 'export=1');
  const isNavItemActive = (item: (typeof allNavItems)[number]) => {
    const targetPath = item.href.split('?')[0];
    if (location.pathname !== targetPath) {
      return false;
    }

    if (item.activeSearch) {
      return isExportRouteActive;
    }

    return !isExportRouteActive || !hasExportNavItem;
  };

  const handleSwitchStore = async (storeId: number) => {
    setStoreSwitcherOpen(false);
    if (resolvedActiveStoreId === storeId) {
      return;
    }

    await switchStore(storeId);
    globalThis.location.reload();
  };

  const handleLeaveCurrentStore = async () => {
    setStoreSwitcherOpen(false);
    setIsMobileMenuOpen(false);
    await leaveCurrentStore();
  };

  const handleLogout = async () => {
    setStoreSwitcherOpen(false);
    setIsMobileMenuOpen(false);
    await logout();
  };

  return (
    <div className="min-h-screen bg-theme-canvas flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col bg-white text-theme-muted border-r border-theme-border transition-all duration-300 relative',
          isSidebarCollapsed ? 'w-20' : 'w-64'
        )}
      >
        <div className="p-4 border-b border-theme-border flex items-center justify-center h-16">
          <img src="/logo.svg" alt="Inventory Portal logo" className="w-10 h-10 shrink-0 object-contain" />
          {!isSidebarCollapsed && (
            <div className="ml-3 overflow-hidden whitespace-nowrap">
              <h1 className="text-lg font-bold text-theme-text tracking-tight">Inventory Portal</h1>
            </div>
          )}
        </div>

        <button
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="absolute -right-3.5 top-20 bg-white text-brand-600 p-1.5 rounded-full shadow-md border-2 border-theme-border hover:bg-theme-subtle transition-all duration-200 z-10"
          title={isSidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
        >
          <ChevronRight
            size={16}
            className={cn('transition-transform duration-300', !isSidebarCollapsed && 'rotate-180')}
          />
        </button>

        <nav className="flex-1 p-2 space-y-2 mt-4">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = isNavItemActive(item);
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200 group relative',
                  isActive
                    ? 'bg-theme-subtle text-brand-600 shadow-sm'
                    : 'hover:bg-theme-subtle hover:text-theme-text',
                  isSidebarCollapsed ? 'justify-center' : ''
                )}
                title={isSidebarCollapsed ? item.label : undefined}
              >
                <Icon
                  size={24}
                  className={cn(
                    isActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-theme-text'
                  )}
                />
                {!isSidebarCollapsed && (
                  <span className="font-medium whitespace-nowrap">{item.label}</span>
                )}

                {isActive && (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-brand-400 rounded-l-full" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-theme-border">
          <div className="space-y-2">
            {hasMultipleStores && (
              <button
                onClick={() => void handleLeaveCurrentStore()}
                className={cn(
                  'flex items-center gap-3 text-sm text-theme-muted hover:bg-theme-subtle hover:text-theme-text rounded-lg transition-colors p-2',
                  isSidebarCollapsed ? 'justify-center' : 'w-full'
                )}
                title="Leave Current Store"
              >
                <Store size={20} />
                {!isSidebarCollapsed && <span>Leave Current Store</span>}
              </button>
            )}

            <button
              onClick={() => void handleLogout()}
              className={cn(
                'flex items-center gap-3 text-sm text-accent-500 hover:bg-accent-50 rounded-lg transition-colors p-2',
                isSidebarCollapsed ? 'justify-center' : 'w-full'
              )}
              title={hasMultipleStores ? 'Sign Out Completely' : 'Sign Out'}
            >
              <LogOut size={20} />
              {!isSidebarCollapsed && (
                <span>{hasMultipleStores ? 'Sign Out Completely' : 'Sign Out'}</span>
              )}
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Header */}
        <header className="bg-white border-b border-theme-border h-16 flex items-center justify-between px-4 md:px-8 z-20">
          <div className="flex items-center gap-4 md:hidden">
            <img src="/logo.svg" alt="Inventory Portal logo" className="w-8 h-8 shrink-0 object-contain" />
            <h1 className="text-lg font-bold text-theme-text">Inventory Portal</h1>
          </div>

          {hasMultipleStores ? (
            <div ref={storeSwitcherRef} className="relative">
              <button
                onClick={() => setStoreSwitcherOpen(o => !o)}
                className="hidden md:flex items-center gap-2 text-theme-text font-medium bg-theme-subtle px-4 py-2 rounded-full hover:bg-slate-200 transition-colors"
              >
                {user.store_logo ? (
                  <img
                    src={user.store_logo}
                    alt={currentStoreLabel}
                    className="w-7 h-7 rounded-full object-cover border border-theme-border"
                  />
                ) : (
                  <Store size={18} className="text-brand-600" />
                )}
                <span>{currentStoreLabel}</span>
                <ChevronDown
                  size={14}
                  className={cn(
                    'text-slate-400 transition-transform',
                    storeSwitcherOpen && 'rotate-180'
                  )}
                />
              </button>

              {storeSwitcherOpen && (
                <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50">
                  <p className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Your Stores
                  </p>
                  {myStores.map(store => (
                    <button
                      key={store.id}
                      onClick={() => void handleSwitchStore(store.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left',
                        store.id === resolvedActiveStoreId && 'bg-theme-subtle text-brand-600'
                      )}
                    >
                      {store.logo ? (
                        <img
                          src={store.logo}
                          alt={store.name}
                          className="w-8 h-8 rounded-lg object-cover border border-slate-200 flex-shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-theme-subtle flex items-center justify-center text-brand-600 font-bold text-sm flex-shrink-0">
                          {store.name.charAt(0)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{store.name}</p>
                        <p className="text-xs text-slate-400 capitalize">{store.role}</p>
                      </div>
                      {store.id === resolvedActiveStoreId && (
                        <div className="w-2 h-2 rounded-full bg-brand-400 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-2 text-theme-text font-medium bg-theme-subtle px-4 py-2 rounded-full">
              {user.store_logo ? (
                <img
                  src={user.store_logo}
                  alt={currentStoreLabel}
                  className="w-7 h-7 rounded-full object-cover border border-theme-border"
                />
              ) : (
                <Store size={18} className="text-brand-600" />
              )}
              <span>{currentStoreLabel}</span>
            </div>
          )}

          <div className="flex items-center gap-4">
            <div className="md:hidden">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 text-theme-text"
              >
                {isMobileMenuOpen ? <X /> : <Menu />}
              </button>
            </div>
            <div className="hidden md:flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-bold text-theme-text">{user.username}</p>
                <p className="text-xs text-slate-400 capitalize">{user.role ?? 'user'}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-theme-subtle flex items-center justify-center text-brand-600 font-bold border border-theme-border">
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
              className="md:hidden bg-white text-theme-muted overflow-hidden absolute top-16 left-0 right-0 z-50 shadow-xl border-b border-theme-border"
            >
              <nav className="p-4 space-y-2">
                <div className="pb-4 mb-4 border-b border-theme-border">
                  <p className="text-sm text-slate-500 mb-1">Current Store</p>
                  <div className="flex items-center gap-2 text-theme-text font-medium">
                    {user.store_logo ? (
                      <img
                        src={user.store_logo}
                        alt={currentStoreLabel}
                        className="w-7 h-7 rounded-full object-cover border border-white"
                      />
                    ) : (
                      <Store size={18} className="text-brand-600" />
                    )}
                    <span>{currentStoreLabel}</span>
                  </div>
                </div>
                {hasMultipleStores && (
                  <div className="pb-4 mb-4 border-b border-theme-border">
                    <p className="text-sm text-slate-500 mb-2">Switch Store</p>
                    <div className="space-y-2">
                      {myStores.map(store => (
                        <button
                          key={store.id}
                          type="button"
                          onClick={() => {
                            setIsMobileMenuOpen(false);
                            void handleSwitchStore(store.id);
                          }}
                          className={cn(
                            'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left',
                            store.id === resolvedActiveStoreId
                              ? 'bg-theme-subtle text-brand-600'
                              : 'hover:bg-theme-subtle hover:text-theme-text'
                          )}
                        >
                          {store.logo ? (
                            <img
                              src={store.logo}
                              alt={store.name}
                              className="w-8 h-8 rounded-lg object-cover border border-white/20"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-theme-subtle flex items-center justify-center text-brand-600 font-bold text-sm">
                              {store.name.charAt(0)}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{store.name}</p>
                            <p className="text-xs text-slate-400 capitalize">{store.role}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {navItems.map(item => (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-lg',
                      isNavItemActive(item)
                        ? 'bg-theme-subtle text-brand-600'
                        : 'hover:bg-theme-subtle hover:text-theme-text'
                    )}
                  >
                    <item.icon size={20} />
                    {item.label}
                  </Link>
                ))}
                {hasMultipleStores && (
                  <button
                    onClick={() => void handleLeaveCurrentStore()}
                    className="w-full flex items-center gap-3 px-4 py-3 text-theme-muted hover:bg-theme-subtle hover:text-theme-text rounded-lg mt-4"
                  >
                    <Store size={20} />
                    Leave Current Store
                  </button>
                )}
                <button
                  onClick={() => void handleLogout()}
                  className="w-full flex items-center gap-3 px-4 py-3 text-accent-500 hover:bg-accent-50 rounded-lg mt-4"
                >
                  <LogOut size={20} />
                  {hasMultipleStores ? 'Sign Out Completely' : 'Sign Out'}
                </button>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <main className="flex-1 overflow-auto bg-theme-canvas p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
