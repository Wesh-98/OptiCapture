import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Check,
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
import { StoreAvatar } from './AdminUi';
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

// The Super Admin shell: a white top bar (logo, store switcher, role, user) and a
// collapsible vertical navbar. All navigation lives in the navbar, never in the top bar.
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
    <div className="relative h-screen flex flex-col bg-theme-canvas">
      {/* Top bar */}
      <header className="bg-white border-b border-theme-border h-16 shrink-0 flex items-center gap-3 px-4 md:px-6 z-30">
        <Link to="/admin" className="flex items-center gap-3 shrink-0">
          <img src="/logo.svg" alt="" className="w-8 h-8 object-contain" />
          <span className="hidden sm:inline text-lg font-bold text-black">Inventory Portal</span>
        </Link>
        <span className="hidden sm:inline text-xl text-theme-border" aria-hidden="true">
          /
        </span>
        <StoreSwitcher stores={stores} current={currentStore} />

        <div className="flex-1" />

        {user && (
          <div className="hidden md:flex items-center gap-3">
            <div className="text-right leading-tight">
              <p className="text-sm font-bold text-theme-text">{user.username}</p>
              <p className="text-xs text-theme-muted capitalize">{user.role}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-theme-subtle border border-theme-border flex items-center justify-center text-brand-600 font-bold">
              {user.username[0]?.toUpperCase()}
            </div>
          </div>
        )}
        <button
          onClick={() => setIsMobileMenuOpen(open => !open)}
          className="md:hidden p-2 text-theme-text"
          aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={isMobileMenuOpen}
        >
          {isMobileMenuOpen ? <X /> : <Menu />}
        </button>
      </header>

      {/* Phone menu: the same vertical list, sliding down under the top bar */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.nav
            aria-label="Main"
            initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
            animate={prefersReducedMotion ? {} : { height: 'auto', opacity: 1 }}
            exit={prefersReducedMotion ? {} : { height: 0, opacity: 0 }}
            className="md:hidden absolute top-16 inset-x-0 z-40 bg-white border-b border-theme-border shadow-xl overflow-hidden"
          >
            <div className="p-3 space-y-1">
              {nav.map(entry => (
                <NavItem
                  key={entry.key}
                  entry={entry}
                  expanded
                  onNavigate={() => setIsMobileMenuOpen(false)}
                />
              ))}
              <SignOutButton onLogout={onLogout} expanded />
            </div>
          </motion.nav>
        )}
      </AnimatePresence>

      <div className="flex-1 flex min-h-0">
        {/* Vertical navbar */}
        <nav
          aria-label="Main"
          className={cn(
            'hidden md:flex flex-col gap-1.5 shrink-0 bg-white border-r border-theme-border p-3 transition-[width] duration-200',
            railOpen ? 'w-56' : 'w-[72px] items-center'
          )}
        >
          <button
            onClick={toggleRail}
            aria-expanded={railOpen}
            aria-label={railOpen ? 'Collapse menu' : 'Expand menu'}
            title={railOpen ? 'Collapse menu' : 'Expand menu'}
            className={cn(
              'mb-1.5 w-12 h-10 flex items-center justify-center rounded-xl border border-theme-border bg-theme-subtle text-brand-600 hover:bg-brand-50 transition-colors',
              railOpen && 'self-end'
            )}
          >
            <ChevronRight
              size={18}
              className={cn('transition-transform duration-200', railOpen && 'rotate-180')}
            />
          </button>
          {nav.map(entry => (
            <NavItem key={entry.key} entry={entry} expanded={railOpen} />
          ))}
          <div className="flex-1" />
          <div className="self-stretch border-t border-theme-border my-1" />
          <SignOutButton onLogout={onLogout} expanded={railOpen} />
        </nav>

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
    'h-12 flex items-center gap-3 rounded-xl text-sm whitespace-nowrap transition-colors',
    expanded ? 'w-full px-3' : 'w-12 justify-center',
    active
      ? 'bg-brand-50 text-brand-700 font-semibold shadow-[inset_-3px_0_0_var(--color-brand-400)]'
      : 'text-theme-muted hover:bg-theme-subtle hover:text-theme-text',
    !to && 'opacity-50 cursor-not-allowed'
  );
  const content = (
    <>
      <Icon size={22} className={active ? 'text-brand-600' : undefined} />
      {expanded && <span>{label}</span>}
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
      title={expanded ? undefined : 'Sign out'}
      className={cn(
        'h-12 flex items-center gap-3 rounded-xl text-sm text-accent-600 hover:bg-accent-50 transition-colors',
        expanded ? 'w-full px-3' : 'w-12 justify-center'
      )}
    >
      <LogOut size={20} />
      {expanded && <span>Sign out</span>}
    </button>
  );
}

// Top-bar picker: jump to any store's inventory, or back to the all-stores page.
function StoreSwitcher({
  stores,
  current,
}: Readonly<{ stores: StoreRow[] | null; current: StoreRow | undefined }>) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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
        className="flex items-center gap-2.5 min-h-11 max-w-[16rem] sm:max-w-xs rounded-xl border border-theme-border bg-theme-subtle py-1.5 pl-1.5 pr-3 text-sm font-semibold text-black hover:bg-white transition-colors"
      >
        {current ? (
          <StoreAvatar name={current.name} logo={current.logo} size="sm" />
        ) : (
          <span className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
            <LayoutDashboard size={16} />
          </span>
        )}
        <span className="truncate">{current?.name ?? 'All stores'}</span>
        {current && (
          <span
            className={cn(
              'w-2 h-2 rounded-full shrink-0',
              current.status === 'active' ? 'bg-brand-600' : 'bg-accent-600'
            )}
            aria-label={current.status}
          />
        )}
        <ChevronDown
          size={16}
          className={cn('shrink-0 text-theme-muted transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-72 rounded-xl border border-theme-border bg-white shadow-lg z-50">
          <div className="p-2 border-b border-theme-border">
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
          <div className="max-h-80 overflow-y-auto p-1">
            <SwitcherOption
              label="All stores"
              selected={!current}
              onClick={() => go('/admin')}
              leading={
                <span className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                  <LayoutDashboard size={16} />
                </span>
              }
            />
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
                  leading={<StoreAvatar name={store.name} logo={store.logo} size="sm" />}
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
        'w-full flex items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors',
        selected ? 'bg-brand-50' : 'hover:bg-theme-subtle'
      )}
    >
      {leading}
      <span className="flex-1 min-w-0">
        <span
          className={cn(
            'block truncate text-sm',
            selected ? 'font-semibold text-brand-700' : 'text-theme-text'
          )}
        >
          {label}
        </span>
        {detail && (
          <span
            className={cn(
              'block text-xs',
              detailTone === 'accent' ? 'text-accent-600' : 'text-theme-muted'
            )}
          >
            {detail}
          </span>
        )}
      </span>
      {selected && <Check size={16} className="text-brand-600 shrink-0" />}
    </button>
  );
}
