import type { LogEntry } from './types';

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

export async function fetchActivityLogs(): Promise<LogEntry[]> {
  const res = await fetch('/api/logs', { credentials: 'include' });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, 'Could not load activity logs.'));
  }

  const data = await res.json().catch(() => null);
  if (!Array.isArray(data)) {
    throw new Error('Invalid response while loading activity logs.');
  }

  return data.flatMap(entry => {
    const normalized = normalizeLogEntry(entry);
    return normalized ? [normalized] : [];
  });
}
