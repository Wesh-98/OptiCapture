import type { LucideIcon } from 'lucide-react';
import {
  Download,
  Layers,
  ListFilter,
  LogIn,
  Pencil,
  PlusCircle,
  Trash2,
  Upload,
} from 'lucide-react';

export interface LogEntry {
  id: number;
  action: string;
  details: string;
  username: string;
  timestamp: string;
}

export const LOG_ACTIONS = [
  'All',
  'CREATE',
  'UPDATE',
  'DELETE',
  'IMPORT',
  'BATCH',
  'EXPORT',
  'LOGIN',
] as const;

export type LogActionFilter = (typeof LOG_ACTIONS)[number];

export const PAGE_SIZE_OPTIONS = [50, 100, 200] as const;
export type LogsPageSize = (typeof PAGE_SIZE_OPTIONS)[number];

interface LogActionMeta {
  badgeClassName: string;
  dotClassName: string;
  icon: LucideIcon;
}

export const LOG_ACTION_META: Record<LogActionFilter, LogActionMeta> = {
  All: {
    badgeClassName: 'bg-slate-100 text-slate-600',
    dotClassName: '',
    icon: ListFilter,
  },
  CREATE: {
    badgeClassName: 'bg-emerald-100 text-emerald-700',
    dotClassName: 'bg-emerald-500',
    icon: PlusCircle,
  },
  UPDATE: {
    badgeClassName: 'bg-blue-100 text-blue-700',
    dotClassName: 'bg-blue-500',
    icon: Pencil,
  },
  DELETE: {
    badgeClassName: 'bg-red-100 text-red-700',
    dotClassName: 'bg-red-500',
    icon: Trash2,
  },
  IMPORT: {
    badgeClassName: 'bg-purple-100 text-purple-700',
    dotClassName: 'bg-purple-500',
    icon: Upload,
  },
  BATCH: {
    badgeClassName: 'bg-amber-100 text-amber-700',
    dotClassName: 'bg-amber-500',
    icon: Layers,
  },
  EXPORT: {
    badgeClassName: 'bg-teal-100 text-teal-700',
    dotClassName: 'bg-teal-500',
    icon: Download,
  },
  LOGIN: {
    badgeClassName: 'bg-slate-100 text-slate-600',
    dotClassName: 'bg-slate-400',
    icon: LogIn,
  },
};
