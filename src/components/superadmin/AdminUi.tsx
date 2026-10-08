import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

// Small pieces shared by the Super Admin pages.

/** Filter-bar dropdowns: solid teal with white text. The open list stays white. */
export const FILTER_SELECT =
  'px-2.5 text-sm font-semibold rounded-lg border border-brand-600 bg-brand-600 text-white cursor-pointer hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-1 [&>option]:bg-white [&>option]:text-black';

/** A white icon at the left of a teal filter dropdown. The dropdown takes `pl-8`. */
export function SelectIcon({
  icon: Icon,
  className,
  children,
}: Readonly<{ icon: LucideIcon; className?: string; children: ReactNode }>) {
  return (
    <span className={cn('relative inline-flex', className)}>
      <Icon
        size={15}
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-white"
      />
      {children}
    </span>
  );
}

/** Filter-bar text boxes: white with a teal outline. */
export const FILTER_INPUT =
  'text-sm rounded-lg border border-brand-400 bg-white focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-400';

/** The selected button in a segmented filter (All / Active / Suspended). */
export const SEGMENT_ACTIVE = 'bg-brand-600 text-white font-semibold shadow-sm';

export function StoreAvatar({
  name,
  logo,
  size = 'md',
  className,
}: Readonly<{
  name: string;
  logo?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}>) {
  const box = { sm: 'w-8 h-8 text-xs', md: 'w-9 h-9 text-sm', lg: 'w-14 h-14 text-xl' }[size];
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        className={cn(
          box,
          'rounded-lg object-cover border border-theme-border bg-white shrink-0',
          className
        )}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        box,
        'rounded-lg bg-theme-canvas text-brand-600 font-bold flex items-center justify-center shrink-0',
        className
      )}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function StoreStatusBadge({ status }: Readonly<{ status: string }>) {
  const active = status === 'active';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border bg-white px-2.5 py-0.5 text-xs font-semibold capitalize',
        active ? 'border-brand-700 text-brand-700' : 'border-accent-600 text-accent-600'
      )}
    >
      {status}
    </span>
  );
}

export function ItemStatusText({ status }: Readonly<{ status: string }>) {
  return (
    <span
      className={cn(
        'text-xs font-semibold',
        status === 'Active' ? 'text-brand-700' : 'text-accent-600'
      )}
    >
      {status === 'Active' ? 'Active' : 'In-Active'}
    </span>
  );
}

/** One number in a page header's stat row. */
export function HeaderStat({
  label,
  value,
  tone = 'default',
}: Readonly<{ label: string; value: string | number; tone?: 'default' | 'brand' | 'accent' }>) {
  return (
    <div className="w-fit flex flex-col rounded-xl border border-theme-border bg-theme-subtle px-3.5 py-2">
      <span
        className={cn(
          'text-xl font-bold leading-tight',
          tone === 'brand' && 'text-brand-600',
          tone === 'accent' && 'text-accent-600',
          tone === 'default' && 'text-black'
        )}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      <span className="text-xs font-semibold uppercase tracking-wide text-theme-muted">
        {label}
      </span>
    </div>
  );
}

export interface Crumb {
  label: string;
  /** Omitted on the last crumb: the page you are on. */
  to?: string;
}

/**
 * Hierarchy trail for the Super Admin pages. "Back" means up a level, not browser
 * history, so it holds after a refresh, a shared link, or a jump to another store.
 * Phones show only the parent as a single back link.
 */
export function Breadcrumb({ trail, className }: Readonly<{ trail: Crumb[]; className?: string }>) {
  const parent = trail.length > 1 ? trail.at(-2) : undefined;
  return (
    <nav aria-label="Breadcrumb" className={cn('text-sm', className)}>
      {parent?.to && (
        <Link
          to={parent.to}
          className="sm:hidden inline-flex items-center gap-1 min-h-11 font-semibold text-brand-600 hover:text-brand-700"
        >
          <ChevronLeft size={16} />
          <span className="truncate">{parent.label}</span>
        </Link>
      )}
      <ol className="hidden sm:flex items-center gap-1.5 min-w-0">
        {trail.map((crumb, i) => {
          const last = i === trail.length - 1;
          return (
            <li
              key={`${i}-${crumb.label}`}
              className={cn('flex items-center gap-1.5', last ? 'min-w-0' : 'shrink-0')}
            >
              {i > 0 && (
                <ChevronRight size={14} className="text-theme-muted shrink-0" aria-hidden="true" />
              )}
              {crumb.to && !last ? (
                <Link
                  to={crumb.to}
                  className="font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page" className="truncate text-black">
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
