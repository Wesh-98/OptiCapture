import {
  PauseCircle,
  Pencil,
  PlayCircle,
  ScanLine,
  Store as StoreIcon,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { ActivityKind } from '../../hooks/useAdminActivity';

// How each kind of change looks on the dashboard card and the Activity log, and what the
// log's filter calls it.
export const ACTIVITY_KIND_STYLES: Record<
  ActivityKind,
  { label: string; icon: LucideIcon; tone: string }
> = {
  capture: { label: 'Captures', icon: ScanLine, tone: 'bg-brand-50 text-brand-600' },
  registered: { label: 'Stores registered', icon: StoreIcon, tone: 'bg-brand-50 text-brand-600' },
  reactivated: {
    label: 'Stores reactivated',
    icon: PlayCircle,
    tone: 'bg-brand-50 text-brand-600',
  },
  updated: {
    label: 'Store details updated',
    icon: Pencil,
    tone: 'bg-theme-subtle text-theme-muted',
  },
  suspended: {
    label: 'Stores suspended',
    icon: PauseCircle,
    tone: 'bg-accent-50 text-accent-600',
  },
  deleted: { label: 'Stores deleted', icon: Trash2, tone: 'bg-accent-50 text-accent-600' },
};
