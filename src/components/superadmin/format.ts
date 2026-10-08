import { formatDistanceToNowStrict } from 'date-fns';
import { parseServerDate } from '../../lib/utils';

/** "2 hours ago" for a server timestamp, or "Never" when there is none. */
export function timeAgo(value: string | null | undefined): string {
  if (!value) return 'Never';
  return formatDistanceToNowStrict(parseServerDate(value), { addSuffix: true });
}

export function formatPrice(value: number | null | undefined): string {
  return `$${(value ?? 0).toFixed(2)}`;
}
