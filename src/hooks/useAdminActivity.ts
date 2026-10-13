import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAdminItemList } from './useAdminItemList';

export const ACTIVITY_KINDS = [
  'capture',
  'registered',
  'suspended',
  'reactivated',
  'updated',
  'deleted',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface ActivityEntry {
  id: number;
  kind: ActivityKind;
  summary: string;
  timestamp: string;
  /** Null once the store has been deleted. */
  store_id: number | null;
  store_name: string;
  username: string | null;
  /** False until this superadmin marks it as seen. Their own actions are always seen. */
  seen: boolean;
}

/** What every activity response carries about this superadmin's seen marker. */
interface SeenState {
  unseen: number;
  /** The newest change there is; "mark all as seen" marks up to it. */
  newest: number;
}

const CARD_SIZE = 5;
const MARK_FAILED = 'Could not mark changes as seen';

// Marks every change up to `newest` as seen. Nothing is deleted: the log is the audit trail.
function useMarkActivitySeen(onMarked: (state: SeenState, through: number) => void) {
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState('');

  const markAllSeen = async (newest: number) => {
    if (marking || newest < 1) return;
    setMarking(true);
    setMarkError('');
    try {
      const res = await fetch('/api/admin/activity/seen', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ through: newest }),
      });
      if (!res.ok) throw new Error(MARK_FAILED);
      onMarked((await res.json()) as SeenState, newest);
    } catch {
      setMarkError(MARK_FAILED);
    } finally {
      setMarking(false);
    }
  };

  return { marking, markError, markAllSeen };
}

// Store events and new captures across every store, newest first, for the Super Admin
// dashboard: the latest five, with the Activity log page holding the rest.
export function useAdminActivity() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [seenState, setSeenState] = useState<SeenState>({ unseen: 0, newest: 0 });
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/activity?limit=${CARD_SIZE}`, {
          credentials: 'include',
        });
        if (res.status === 401) {
          navigate('/login');
          return;
        }
        if (!res.ok) throw new Error('Failed to load recent changes');
        const data = (await res.json()) as { items: ActivityEntry[]; total: number } & SeenState;
        if (cancelled) return;
        setEntries(data.items);
        setTotal(data.total);
        setSeenState({ unseen: data.unseen, newest: data.newest });
        setError('');
      } catch (err) {
        if (cancelled) return;
        setEntries([]);
        setError(err instanceof Error ? err.message : 'Failed to load recent changes');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const mark = useMarkActivitySeen((state, through) => {
    setSeenState(state);
    setEntries(
      rows => rows?.map(row => (row.id <= through ? { ...row, seen: true } : row)) ?? null
    );
  });

  return {
    entries,
    total,
    error,
    unseen: seenState.unseen,
    marking: mark.marking,
    markError: mark.markError,
    markAllSeen: () => mark.markAllSeen(seenState.newest),
  };
}

export type ActivityKindFilter = ActivityKind | 'all';

// The kind lives in the URL (`?kind=`), beside the store, so a shared link lands on the
// same view.
const KIND_PARAM = 'kind';

// Inside one store the filter narrows to captures only: the other kinds are store-level
// events, which are filtered across every store.
const ONE_STORE_KINDS: readonly ActivityKind[] = ['capture'];

/** The kinds the filter offers: all of them across every store, captures inside one. */
export function activityKindsFor(storeSelected: boolean): readonly ActivityKind[] {
  return storeSelected ? ONE_STORE_KINDS : ACTIVITY_KINDS;
}

function parseKind(raw: string | null, storeSelected: boolean): ActivityKindFilter {
  const kind = activityKindsFor(storeSelected).find(option => option === raw);
  return kind ?? 'all';
}

// The Activity log page: every store event and capture the log still holds, a page at a
// time, across every store or one, optionally a single kind.
export function useAdminActivityLog() {
  const [searchParams] = useSearchParams();
  // A kind that does not apply inside one store falls back to all of that store's changes.
  const kind = parseKind(searchParams.get(KIND_PARAM), searchParams.has('store'));
  const list = useAdminItemList<ActivityEntry, SeenState>({
    endpoint: '/api/admin/activity',
    filter: { name: KIND_PARAM, value: kind },
    failureText: 'Failed to load the activity log',
  });
  const { reload, extra } = list;
  const mark = useMarkActivitySeen(reload);
  const setKind = (next: ActivityKindFilter) =>
    list.setParam(KIND_PARAM, next === 'all' ? null : next);

  return {
    ...list,
    kind,
    setKind,
    unseen: extra?.unseen ?? 0,
    marking: mark.marking,
    markError: mark.markError,
    markAllSeen: () => mark.markAllSeen(extra?.newest ?? 0),
  };
}
