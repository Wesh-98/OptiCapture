import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Search,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useAuth } from '../../context/AuthContext';
import { useAdminStoreList } from '../../hooks/useAdminStoreList';
import { cn } from '../../lib/utils';
import type { StoreRow } from './types';

interface Props {
  onLogout: () => void;
  children: ReactNode;
  /** Pages that draw their own full-width header bands and panes skip the page padding. */
  bare?: boolean;
}

const STORE_PAGE = /^\/admin\/stores\/(\d+)/;
const LAST_STORE_KEY = 'opticapture.admin.lastStoreId';
const RAIL_OPEN_KEY = 'opticapture.admin.railOpen';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows and blocked storage just lose the preference.
  }
}

interface NavEntry {
  key: string;
  label: string;
  icon: LucideIcon;
  to: string | null;
  active: boolean;
}

// The Super Admin shell, matching the store portal: a collapsible sidebar (logo, navigation,
// sign out) and a top bar with the store switcher and the user. Navigation stays in the sidebar.
export function AdminLayout({ onLogout, children, bare = false }: Readonly<Props>) {
  const { user } = useAuth();
  const location = useLocation();
  const prefersReducedMotion = useReducedMotion();
  const stores = useAdminStoreList();

  const viewedStoreId = Number(STORE_PAGE.exec(location.pathname)?.[1] ?? Number.NaN);
  const onStorePage = !Number.isNaN(viewedStoreId);

  const [railOpen, setRailOpen] = useState(() => readStorage(RAIL_OPEN_KEY) === 'true');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (onStorePage) writeStorage(LAST_STORE_KEY, String(viewedStoreId));
  }, [onStorePage, viewedStoreId]);

  const toggleRail = () => {
    setRailOpen(open => {
      writeStorage(RAIL_OPEN_KEY, String(!open));
      return !open;
    });
  };

  // "Store inventory" opens the store being viewed, else the last one viewed, else the first.
  const lastStoreId = Number(readStorage(LAST_STORE_KEY) ?? Number.NaN);
  const inventoryStoreId = onStorePage
    ? viewedStoreId
    : stores?.some(s => s.id === lastStoreId)
      ? lastStoreId
      : stores?.[0]?.id;

  const nav: NavEntry[] = [
    {
      key: 'all',
      label: 'All stores',
      icon: LayoutDashboard,
      to: '/admin',
      active: location.pathname === '/admin',
    },
    {
      key: 'inventory',
      label: 'Store inventory',
      icon: Package,
      to: inventoryStoreId === undefined ? null : `/admin/stores/${inventoryStoreId}`,
      active: onStorePage,
    },
    {
      key: 'settings',
      label: 'Store settings',
      icon: Settings,
      to: '/admin/stores',
      active: location.pathname === '/admin/stores',
    },
  ];

  const currentStore = onStorePage ? stores?.find(s => s.id === viewedStoreId) : undefined;

  return (
    <div className="h-screen bg-theme-canvas flex flex-col md:flex-row">
      {/* Sidebar: the same shape as the store portal's. Collapsed it shows icons only. */}
      <aside
        className={cn(
          'hidden md:flex flex-col shrink-0 bg-white text-theme-muted border-r border-theme-border transition-all duration-300 relative',
          railOpen ? 'w-64' : 'w-20'
        )}
      >
        <Link
          to="/admin"
          className="p-4 border-b border-theme-border flex items-center justify-center h-16"
        >
          <img
            src="/logo.svg"
            alt="Inventory Portal logo"
            className="w-10 h-10 shrink-0 object-contain"
          />
          {railOpen && (
            <span className="ml-3 overflow-hidden whitespace-nowrap text-lg font-bold text-theme-text tracking-tight">
              Inventory Portal
            </span>
          )}
        </Link>

        {/* Centred on the corner where the sidebar edge meets the top bar (h-16), clear of the
            breadcrumbs that pages start with. */}
        <button
          onClick={toggleRail}
          aria-expanded={railOpen}
          aria-label={railOpen ? 'Collapse menu' : 'Expand menu'}
          title={railOpen ? 'Collapse menu' : 'Expand menu'}
          className="absolute -right-3.5 top-12 bg-white text-brand-600 p-1.5 rounded-full shadow-md border-2 border-theme-border hover:bg-theme-subtle transition-all duration-200 z-10"
        >
          <ChevronRight
            size={16}
            className={cn('transition-transform duration-300', railOpen && 'rotate-180')}
          />
        </button>

        <nav aria-label="Main" className="flex-1 p-2 space-y-2 mt-4">
          {nav.map(entry => (
            <NavItem key={entry.key} entry={entry} expanded={railOpen} />
          ))}
        </nav>

        <div className="p-4 border-t border-theme-border">
          <SignOutButton onLogout={onLogout} expanded={railOpen} />
        </div>
      </aside>

      <div className="relative flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        {/* Top bar: the store switcher and who is signed in. Navigation stays in the sidebar. */}
        <header className="bg-white border-b border-theme-border h-16 shrink-0 flex items-center justify-between gap-3 px-4 md:px-8 z-20">
          <Link to="/admin" className="flex items-center gap-3 md:hidden shrink-0">
            <img
              src="/logo.svg"
              alt="Inventory Portal logo"
              className="w-8 h-8 shrink-0 object-contain"
            />
            <span className="hidden sm:inline text-lg font-bold text-theme-text">
              Inventory Portal
            </span>
          </Link>

          <StoreSwitcher stores={stores} current={currentStore} />

          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsMobileMenuOpen(open => !open)}
              className="md:hidden p-2 text-theme-text"
              aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={isMobileMenuOpen}
            >
              {isMobileMenuOpen ? <X /> : <Menu />}
            </button>
            {user && (
              <div className="hidden md:flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-bold text-theme-text">{user.username}</p>
                  <p className="text-xs text-slate-400 capitalize">{user.role}</p>
                </div>
                <div className="w-10 h-10 rounded-full bg-theme-subtle flex items-center justify-center text-brand-600 font-bold border border-theme-border">
                  {user.username[0]?.toUpperCase()}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Phone menu: the same list, sliding down under the top bar */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.nav
              aria-label="Main"
              initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
              animate={prefersReducedMotion ? {} : { height: 'auto', opacity: 1 }}
              exit={prefersReducedMotion ? {} : { height: 0, opacity: 0 }}
              className="md:hidden absolute top-16 inset-x-0 z-40 bg-white text-theme-muted border-b border-theme-border shadow-xl overflow-hidden"
            >
              <div className="p-4 space-y-2">
                {nav.map(entry => (
                  <NavItem
                    key={entry.key}
                    entry={entry}
                    expanded
                    onNavigate={() => setIsMobileMenuOpen(false)}
                  />
                ))}
                <div className="pt-2">
                  <SignOutButton onLogout={onLogout} expanded />
                </div>
              </div>
            </motion.nav>
          )}
        </AnimatePresence>

        <main className="flex-1 min-w-0 overflow-auto">
          {bare ? children : <div className="p-4 md:py-6 md:pr-6 md:pl-3">{children}</div>}
        </main>
      </div>
    </div>
  );
}

function NavItem({
  entry,
  expanded,
  onNavigate,
}: Readonly<{ entry: NavEntry; expanded: boolean; onNavigate?: () => void }>) {
  const { label, icon: Icon, to, active } = entry;
  const className = cn(
    'flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200 group relative',
    active
      ? 'bg-theme-subtle text-brand-600 shadow-sm'
      : 'hover:bg-theme-subtle hover:text-theme-text',
    !expanded && 'justify-center',
    !to && 'opacity-50 cursor-not-allowed'
  );
  const content = (
    <>
      <Icon
        size={24}
        className={active ? 'text-brand-600' : 'text-slate-400 group-hover:text-theme-text'}
      />
      {expanded && <span className="font-medium whitespace-nowrap">{label}</span>}
      {active && (
        <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-brand-400 rounded-l-full" />
      )}
    </>
  );
  if (!to) {
    return (
      <span className={className} aria-disabled="true" title={`${label} (no stores yet)`}>
        {content}
      </span>
    );
  }
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={expanded ? undefined : label}
      title={expanded ? undefined : label}
      className={className}
    >
      {content}
    </Link>
  );
}

function SignOutButton({
  onLogout,
  expanded,
}: Readonly<{ onLogout: () => void; expanded: boolean }>) {
  return (
    <button
      onClick={onLogout}
      aria-label={expanded ? undefined : 'Sign out'}
      title="Sign out"
      className={cn(
        'flex items-center gap-3 text-sm text-accent-500 hover:bg-accent-50 rounded-lg transition-colors p-2',
        expanded ? 'w-full' : 'justify-center w-full'
      )}
    >
      <LogOut size={20} />
      {expanded && <span>Sign out</span>}
    </button>
  );
}

function StoreMark({
  name,
  logo,
  round = false,
}: Readonly<{ name: string; logo?: string | null; round?: boolean }>) {
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        className={cn(
          'object-cover border border-theme-border shrink-0',
          round ? 'w-7 h-7 rounded-full' : 'w-8 h-8 rounded-lg'
        )}
      />
    );
  }
  return (
    <span
      className={cn(
        'bg-theme-subtle flex items-center justify-center text-brand-600 font-bold text-sm shrink-0',
        round ? 'w-7 h-7 rounded-full' : 'w-8 h-8 rounded-lg'
      )}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

// Top-bar picker in the store portal's style: a pill for the current store and a list of
// every store. A search box appears once there are enough stores to need one.
function StoreSwitcher({
  stores,
  current,
}: Readonly<{ stores: StoreRow[] | null; current: StoreRow | undefined }>) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchable = (stores?.length ?? 0) > 6;

  useEffect(() => {
    if (!open) return;
    // Opening the switcher is a request to search, so the box takes focus right away.
    searchRef.current?.focus();
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (path: string) => {
    setOpen(false);
    setQuery('');
    navigate(path);
  };

  const needle = query.trim().toLowerCase();
  const matches = (stores ?? []).filter(s => s.name.toLowerCase().includes(needle));

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-2 max-w-[16rem] sm:max-w-xs text-theme-text font-medium bg-theme-subtle px-4 py-2 rounded-full hover:bg-slate-200 transition-colors"
      >
        {current ? (
          <StoreMark name={current.name} logo={current.logo} round />
        ) : (
          <LayoutDashboard size={18} className="text-brand-600 shrink-0" />
        )}
        <span className="truncate">{current?.name ?? 'All stores'}</span>
        {current && current.status !== 'active' && (
          <span className="text-xs font-semibold text-accent-600 shrink-0">Suspended</span>
        )}
        <ChevronDown
          size={14}
          className={cn('text-slate-400 transition-transform shrink-0', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50">
          {searchable && (
            <div className="px-2 pt-1 pb-2">
              <label className="relative block">
                <span className="sr-only">Search store name</span>
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-muted"
                />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search Store Name"
                  className="w-full pl-8 pr-3 py-2 text-sm border border-theme-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
              </label>
            </div>
          )}
          <div className="max-h-80 overflow-y-auto">
            <SwitcherOption
              label="All stores"
              detail="Every store at a glance"
              selected={!current}
              onClick={() => go('/admin')}
              leading={
                <span className="w-8 h-8 rounded-lg bg-theme-subtle flex items-center justify-center text-brand-600 shrink-0">
                  <LayoutDashboard size={16} />
                </span>
              }
            />
            <p className="px-3 pt-2 pb-1 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Stores
            </p>
            {stores === null ? (
              <p className="px-3 py-2 text-sm text-theme-muted">Loading stores...</p>
            ) : matches.length === 0 ? (
              <p className="px-3 py-2 text-sm text-theme-muted">No stores match.</p>
            ) : (
              matches.map(store => (
                <SwitcherOption
                  key={store.id}
                  label={store.name}
                  detail={
                    store.status === 'active'
                      ? `${store.item_count.toLocaleString()} items`
                      : 'Suspended'
                  }
                  detailTone={store.status === 'active' ? 'muted' : 'accent'}
                  selected={current?.id === store.id}
                  onClick={() => go(`/admin/stores/${store.id}`)}
                  leading={<StoreMark name={store.name} logo={store.logo} />}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SwitcherOption({
  label,
  detail,
  detailTone = 'muted',
  selected,
  onClick,
  leading,
}: Readonly<{
  label: string;
  detail?: string;
  detailTone?: 'muted' | 'accent';
  selected: boolean;
  onClick: () => void;
  leading: ReactNode;
}>) {
  return (
    <button
      onClick={onClick}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left',
        selected && 'bg-theme-subtle text-brand-600'
      )}
    >
      {leading}
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-slate-800 truncate">{label}</span>
        {detail && (
          <span
            className={cn(
              'block text-xs',
              detailTone === 'accent' ? 'text-accent-600' : 'text-slate-400'
            )}
          >
            {detail}
          </span>
        )}
      </span>
      {selected && <span className="w-2 h-2 rounded-full bg-brand-400 shrink-0" />}
    </button>
  );
}
