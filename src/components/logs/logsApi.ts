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

/**
 * The picked dates as instants: midnight at the start of the first day and midnight after
 * the last, both in the viewer's own time zone. The server stores UTC, so sending the bare
 * dates filtered by UTC days instead of the days the viewer meant.
 */
export function localDayRangeUtc(
  from?: string,
  to?: string
): { from_utc?: string; to_utc?: string } {
  const localMidnight = (date: string, addDays = 0): string | undefined => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) return undefined;
    const instant = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + addDays);
    return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
  };
  return {
    ...(from ? { from_utc: localMidnight(from) } : {}),
    ...(to ? { to_utc: localMidnight(to, 1) } : {}),
  };
}

export async function fetchActivityLogs(query: ActivityLogQuery): Promise<ActivityLogPage> {
  const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
  if (query.action) params.set('action', query.action);
  const dayRange = localDayRangeUtc(query.from, query.to);
  if (dayRange.from_utc) params.set('from_utc', dayRange.from_utc);
  if (dayRange.to_utc) params.set('to_utc', dayRange.to_utc);
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
