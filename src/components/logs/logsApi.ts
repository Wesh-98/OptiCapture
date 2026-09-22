import type { LogEntry } from './types';

export interface ActivityLogQuery {
  action?: string;
  from?: string;
  to?: string;
  q?: string;
  page: number;
  limit: number;
}

export interface ActivityLogPage {
  items: LogEntry[];
  total: number;
  storeTotal: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeLogEntry(entry: unknown): LogEntry | null {
  if (!isRecord(entry)) {
    return null;
  }

  const id =
    typeof entry.id === 'number' && Number.isFinite(entry.id) ? Math.trunc(entry.id) : null;
  if (id === null) {
    return null;
  }

  return {
    id,
    action: readString(entry.action).trim() || 'UNKNOWN',
    details: readString(entry.details),
    username: readString(entry.username).trim() || 'Unknown user',
    timestamp: readString(entry.timestamp),
  };
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    if (payload?.error) {
      return payload.error;
    }
  }

  const text = await res.text().catch(() => '');
  return text.trim() || fallback;
}

export async function fetchActivityLogs(query: ActivityLogQuery): Promise<ActivityLogPage> {
  const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
  if (query.action) params.set('action', query.action);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.q) params.set('q', query.q);

  const res = await fetch(`/api/logs?${params.toString()}`, { credentials: 'include' });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, 'Could not load activity logs.'));
  }

  const data = await res.json().catch(() => null);
  if (!isRecord(data) || !Array.isArray(data.items)) {
    throw new Error('Invalid response while loading activity logs.');
  }

  const items = data.items.flatMap(entry => {
    const normalized = normalizeLogEntry(entry);
    return normalized ? [normalized] : [];
  });
  const total = typeof data.total === 'number' && data.total >= 0 ? Math.trunc(data.total) : 0;
  const storeTotal =
    typeof data.store_total === 'number' && data.store_total >= 0
      ? Math.trunc(data.store_total)
      : total;
  return { items, total, storeTotal };
}
