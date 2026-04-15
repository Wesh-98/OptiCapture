import { clsx, type ClassValue } from "clsx"; //conditional composition of classNames.
import { twMerge } from "tailwind-merge"; //confict resolution for Tailwind CSS class names.

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function normalizeServerTimestamp(value: string): string {
  const trimmed = value.trim();

  // SQLite CURRENT_TIMESTAMP is stored in UTC without a timezone suffix, so
  // we normalize it before Date parsing to avoid rendering it as local time.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
    return `${trimmed.replace(" ", "T")}Z`;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
    return `${trimmed}Z`;
  }

  return trimmed;
}

export function parseServerDate(value: unknown): Date {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }

  const raw =
    typeof value === "string" || typeof value === "number" ? value : Date.now();
  const next =
    typeof raw === "string"
      ? new Date(normalizeServerTimestamp(raw))
      : new Date(raw);

  return Number.isNaN(next.getTime()) ? new Date() : next;
}

export function formatServerTime(value: unknown): string {
  return parseServerDate(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
