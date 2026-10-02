import { clsx, type ClassValue } from 'clsx'; //conditional composition of classNames.
import { twMerge } from 'tailwind-merge'; //confict resolution for Tailwind CSS class names.

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function normalizeServerTimestamp(value: string): string {
  const trimmed = value.trim();

  // SQLite CURRENT_TIMESTAMP is stored in UTC without a timezone suffix, so
  // we normalize it before Date parsing to avoid rendering it as local time.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
    return `${trimmed.replace(' ', 'T')}Z`;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
    return `${trimmed}Z`;
  }

  return trimmed;
}

// Parse a server timestamp (stored as UTC) or return null when it is missing or invalid.
export function parseServerTimestamp(value: unknown): Date | null {
  let next: Date;
  if (value instanceof Date) next = value;
  else if (typeof value === 'string') next = new Date(normalizeServerTimestamp(value));
  else if (typeof value === 'number') next = new Date(value);
  else return null;

  return Number.isNaN(next.getTime()) ? null : next;
}

export function parseServerDate(value: unknown): Date {
  return parseServerTimestamp(value) ?? new Date();
}

export function formatServerTime(value: unknown): string {
  return parseServerDate(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}
