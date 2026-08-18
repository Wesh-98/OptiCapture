import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { SessionItem, UiStatus } from '../components/scan/types';
type FetchInit = Parameters<typeof globalThis.fetch>[1];

export interface PollCursor {
  updatedAt: string;
  id: number;
}

export interface SessionDraftAlert {
  message: string;
  visible: boolean;
}

export function buildPollUrl(sessionId: string, cursor: PollCursor | null): string {
  return cursor
    ? `/api/session/${sessionId}?since_updated_at=${encodeURIComponent(cursor.updatedAt)}&since_id=${cursor.id}`
    : `/api/session/${sessionId}`;
}

export function parseSessionEnvelope(raw: unknown): {
  items: SessionItem[];
  expiresAt: string | null;
  status: 'active' | 'draft' | 'completed' | null;
  label: string | null;
} {
  if (Array.isArray(raw)) {
    return { items: raw as SessionItem[], expiresAt: null, status: null, label: null };
  }

  const obj = raw as {
    items?: SessionItem[];
    expires_at?: string;
    status?: 'active' | 'draft' | 'completed';
    label?: string | null;
  };

  return {
    items: obj.items ?? [],
    expiresAt: obj.expires_at ?? null,
    status: obj.status ?? null,
    label: obj.label ?? null,
  };
}

export function mergeSessionItems(
  prevItems: SessionItem[],
  incoming: SessionItem[],
  isFullRefresh: boolean
): SessionItem[] {
  if (isFullRefresh) return incoming;
  if (incoming.length === 0) return prevItems;
  const incomingIds = new Set(incoming.map(i => i.id));
  return [...incoming, ...prevItems.filter(i => !incomingIds.has(i.id))];
}

export function autoSelectIncoming(
  prev: Set<number>,
  incoming: SessionItem[],
  manuallyDeselected: Set<number>
): Set<number> {
  const next = new Set(prev);
  for (const item of incoming) {
    if (
      item.lookup_status === 'new_candidate' &&
      !item.exists_in_inventory &&
      !manuallyDeselected.has(item.id)
    ) {
      next.add(item.id);
    }
  }
  return next;
}

export function reconcileSelectedIds(
  prev: Set<number>,
  nextItems: SessionItem[],
  incoming: SessionItem[],
  manuallyDeselected: Set<number>
): Set<number> {
  const nextItemIds = new Set(nextItems.map(item => item.id));
  const retained = new Set([...prev].filter(id => nextItemIds.has(id)));
  return autoSelectIncoming(retained, incoming, manuallyDeselected);
}

export function getLatestCursor(items: SessionItem[]): PollCursor | null {
  const latest = items.find(item => item.updated_at);
  return latest?.updated_at ? { updatedAt: latest.updated_at, id: latest.id } : null;
}

interface SessionDraftAlertEvaluation {
  incomingCount: number;
  sessionStatus: 'active' | 'draft' | 'completed' | null;
  sessionStartTime: number | null;
  lastLongSessionAlertAt: number | null;
  lastItemAddedAt: number | null;
  idleAlertFired: boolean;
  now?: number;
}

export function evaluateSessionDraftAlert(params: SessionDraftAlertEvaluation): {
  alert: SessionDraftAlert | null;
  nextLastLongSessionAlertAt: number | null;
  nextIdleAlertFired: boolean;
} {
  if (!params.incomingCount || params.sessionStatus !== 'active') {
    return {
      alert: null,
      nextLastLongSessionAlertAt: params.lastLongSessionAlertAt,
      nextIdleAlertFired: params.idleAlertFired,
    };
  }

  const now = params.now ?? Date.now();
  const thirtyMin = 30 * 60 * 1000;

  if (params.sessionStartTime) {
    const sessionAge = now - params.sessionStartTime;
    const tooSoon =
      params.lastLongSessionAlertAt != null && now - params.lastLongSessionAlertAt < thirtyMin;

    if (sessionAge >= thirtyMin && !tooSoon) {
      return {
        alert: {
          message: `You've been scanning for ${Math.floor(sessionAge / 60000)} min - save as draft to protect your progress.`,
          visible: true,
        },
        nextLastLongSessionAlertAt: now,
        nextIdleAlertFired: params.idleAlertFired,
      };
    }
  }

  if (
    params.lastItemAddedAt &&
    !params.idleAlertFired &&
    now - params.lastItemAddedAt > 10 * 60 * 1000
  ) {
    return {
      alert: {
        message: 'No new items scanned for 10 min - save as draft to protect your progress.',
        visible: true,
      },
      nextLastLongSessionAlertAt: params.lastLongSessionAlertAt,
      nextIdleAlertFired: true,
    };
  }

  return {
    alert: null,
    nextLastLongSessionAlertAt: params.lastLongSessionAlertAt,
    nextIdleAlertFired: params.idleAlertFired,
  };
}

export function getPollFailureOutcome(failCount: number): {
  shouldStopPolling: boolean;
  uiStatus: UiStatus | null;
  statusMessage: string | null;
  pollError: string;
} {
  if (failCount >= 3) {
    return {
      shouldStopPolling: true,
      uiStatus: 'error',
      statusMessage: 'Server is offline or unreachable.',
      pollError: 'Server offline - polling stopped. Restart the server and refresh.',
    };
  }

  return {
    shouldStopPolling: false,
    uiStatus: null,
    statusMessage: null,
    pollError: 'Could not refresh live scan feed.',
  };
}

export function getSessionExpiryWarningMessage(
  sessionExpiresAt: string | null,
  sessionStatus: 'active' | 'draft' | 'completed' | null,
  now = Date.now()
): string | null {
  if (!sessionExpiresAt || sessionStatus !== 'active') {
    return null;
  }

  const msLeft = new Date(sessionExpiresAt).getTime() - now;
  return msLeft > 0 && msLeft < 30 * 60 * 1000
    ? `Session expires in ${Math.ceil(msLeft / 60000)} min - save as draft or commit soon`
    : null;
}

export function buildSessionStorageEntries(
  sessionId: string,
  otp: string,
  storeId: number | null | undefined
): Array<[key: string, value: string]> {
  const entries: Array<[string, string]> = [
    ['scan_session_id', sessionId],
    ['scan_otp', otp],
  ];

  if (storeId != null) {
    entries.push(['scan_store_id', String(storeId)]);
  }

  return entries;
}

export function shouldClearStoredSessionForStore(
  savedStoreId: string | null,
  currentStoreId: number | null | undefined
): boolean {
  return savedStoreId != null && currentStoreId != null && String(currentStoreId) !== savedStoreId;
}

interface ParamSessionSummary {
  session_id: string;
  otp: string;
  status: 'active' | 'draft' | 'completed';
  label?: string | null;
}

export function resolveParamResumeMatch(
  found: ParamSessionSummary,
  currentStoreId: number | null | undefined,
  now = Date.now()
): {
  sessionId: string;
  otp: string;
  sessionStatus: 'active' | 'draft' | 'completed';
  sessionLabel: string | null;
  storageEntries: Array<[key: string, value: string]>;
  shouldClearStoredSession: boolean;
  sessionStartTime: number;
  lastItemAddedAt: number;
} {
  return {
    sessionId: found.session_id,
    otp: found.otp,
    sessionStatus: found.status,
    sessionLabel: found.label ?? null,
    storageEntries:
      found.status === 'completed'
        ? []
        : buildSessionStorageEntries(found.session_id, found.otp, currentStoreId),
    shouldClearStoredSession: found.status === 'completed',
    sessionStartTime: now,
    lastItemAddedAt: now,
  };
}

export function resolveStoredSessionResume(
  savedId: string,
  savedOtp: string,
  envelope: ReturnType<typeof parseSessionEnvelope>,
  fallbackStatus: 'active' | 'draft' | 'completed' | null | undefined,
  fallbackLabel: string | null | undefined,
  manuallyDeselected: Set<number>,
  now = Date.now()
):
  | { kind: 'completed' }
  | {
      kind: 'resumed';
      sessionId: string;
      otp: string;
      sessionStatus: 'active' | 'draft' | 'completed' | null;
      sessionLabel: string | null;
      items: SessionItem[];
      uiStatus: UiStatus;
      statusMessage: string;
      selectedIds: Set<number>;
      lastPollCursor: PollCursor | null;
      sessionStartTime: number;
      lastItemAddedAt: number;
      expiresAt: string | null;
    } {
  if (envelope.status === 'completed') {
    return { kind: 'completed' };
  }

  return {
    kind: 'resumed',
    sessionId: savedId,
    otp: savedOtp,
    sessionStatus: envelope.status ?? fallbackStatus ?? 'active',
    sessionLabel: envelope.label ?? fallbackLabel ?? null,
    items: envelope.items,
    uiStatus: 'ready',
    statusMessage: 'Session resumed. Scan the QR code with your phone.',
    selectedIds: reconcileSelectedIds(
      new Set(),
      envelope.items,
      envelope.items,
      manuallyDeselected
    ),
    lastPollCursor: getLatestCursor(envelope.items),
    sessionStartTime: now,
    lastItemAddedAt: now,
    expiresAt: envelope.expiresAt,
  };
}

export function getSessionActivationAction(
  sessionId: string | null,
  sessionStatus: 'active' | 'draft' | 'completed' | null
): 'stop' | 'poll' | 'view_only' {
  if (!sessionId) {
    return 'stop';
  }

  return sessionStatus === 'completed' ? 'view_only' : 'poll';
}

export function toggleSessionSelection(
  prev: Set<number>,
  id: number,
  manuallyDeselected: Set<number>
): {
  selectedIds: Set<number>;
  manuallyDeselected: Set<number>;
} {
  const selectedIds = new Set(prev);
  const nextManuallyDeselected = new Set(manuallyDeselected);

  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    nextManuallyDeselected.add(id);
  } else {
    selectedIds.add(id);
    nextManuallyDeselected.delete(id);
  }

  return {
    selectedIds,
    manuallyDeselected: nextManuallyDeselected,
  };
}

export function buildCreateSessionRequest(): {
  url: string;
  init: FetchInit;
} {
  return {
    url: '/api/session/create',
    init: { method: 'POST', credentials: 'include' },
  };
}

export function resolveCreatedSession(
  sessionId: string,
  otp: string,
  storeId: number | null | undefined,
  now = Date.now()
): {
  sessionId: string;
  otp: string;
  sessionStatus: 'active';
  items: SessionItem[];
  uiStatus: UiStatus;
  statusMessage: string;
  sessionStartTime: number;
  lastItemAddedAt: number;
  idleAlertFired: boolean;
  lastLongSessionAlertAt: number | null;
  storageEntries: Array<[key: string, value: string]>;
} {
  return {
    sessionId,
    otp,
    sessionStatus: 'active',
    items: [],
    uiStatus: 'ready',
    statusMessage: 'Session ready. Scan the QR code with your phone.',
    sessionStartTime: now,
    lastItemAddedAt: now,
    idleAlertFired: false,
    lastLongSessionAlertAt: null,
    storageEntries: buildSessionStorageEntries(sessionId, otp, storeId),
  };
}

export function getCreateSessionFailureState(): {
  uiStatus: UiStatus;
  statusMessage: string;
  sessionId: null;
  otp: null;
  items: SessionItem[];
} {
  return {
    uiStatus: 'error',
    statusMessage: 'Could not create scan session.',
    sessionId: null,
    otp: null,
    items: [],
  };
}

export function useScanSession(
  addToast: (type: 'success' | 'error' | 'warning', message: string) => void
) {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [otp, setOtp] = useState<string | null>(null);
  const [items, setItems] = useState<SessionItem[]>([]);
  const [sessionStatus, setSessionStatus] = useState<'active' | 'draft' | 'completed' | null>(null);
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [uiStatus, setUiStatus] = useState<UiStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('Preparing scanner session...');
  const [sessionLoading, setSessionLoading] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [draftAlert, setDraftAlert] = useState<SessionDraftAlert>({
    message: '',
    visible: false,
  });

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isBusyRef = useRef(false);
  const pollFailCountRef = useRef(0);
  const lastPollCursorRef = useRef<PollCursor | null>(null);
  const manuallyDeselectedRef = useRef<Set<number>>(new Set());
  const sessionStartTimeRef = useRef<number | null>(null);
  const lastItemAddedAtRef = useRef<number | null>(null);
  const idleAlertFiredRef = useRef(false);
  const lastLongSessionAlertRef = useRef<number | null>(null);
  const sessionStatusRef = useRef<'active' | 'draft' | 'completed' | null>(null);
  const expiryWarnedRef = useRef(false);
  const itemsRef = useRef<SessionItem[]>([]);
  const selectedIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    sessionStatusRef.current = sessionStatus;
  }, [sessionStatus]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  const clearStoredSession = useCallback(() => {
    sessionStorage.removeItem('scan_session_id');
    sessionStorage.removeItem('scan_otp');
    sessionStorage.removeItem('scan_store_id');
  }, []);

  useEffect(() => {
    if (!sessionExpiresAt || sessionStatus !== 'active') return;

    expiryWarnedRef.current = false;

    const check = () => {
      if (expiryWarnedRef.current) return;

      const warningMessage = getSessionExpiryWarningMessage(sessionExpiresAt, sessionStatus);
      if (warningMessage) {
        expiryWarnedRef.current = true;
        addToast('warning', warningMessage);
      }
    };

    check();
    const id = globalThis.setInterval(check, 60_000);
    return () => globalThis.clearInterval(id);
  }, [sessionExpiresAt, sessionStatus, addToast]);

  const createSession = useCallback(async () => {
    if (isBusyRef.current) return;

    isBusyRef.current = true;
    setSessionLoading(true);
    setUiStatus('loading');
    setStatusMessage('Creating a new scan session...');
    setPollError(null);
    setSelectedIds(new Set());
    setSessionLabel(null);
    setSessionExpiresAt(null);
    manuallyDeselectedRef.current = new Set();

    try {
      const request = buildCreateSessionRequest();
      const res = await fetch(request.url, request.init);
      if (!res.ok) throw new Error(`Session creation failed: ${res.status}`);

      const data = await res.json();
      const created = resolveCreatedSession(data.sessionId, data.otp, user?.store_id);
      setSessionId(created.sessionId);
      setOtp(created.otp);
      setSessionStatus(created.sessionStatus);
      sessionStartTimeRef.current = created.sessionStartTime;
      lastItemAddedAtRef.current = created.lastItemAddedAt;
      idleAlertFiredRef.current = created.idleAlertFired;
      lastLongSessionAlertRef.current = created.lastLongSessionAlertAt;
      setItems(created.items);
      setUiStatus(created.uiStatus);
      setStatusMessage(created.statusMessage);
      for (const [key, value] of created.storageEntries) {
        sessionStorage.setItem(key, value);
      }
    } catch {
      const failure = getCreateSessionFailureState();
      setUiStatus(failure.uiStatus);
      setStatusMessage(failure.statusMessage);
      setSessionId(failure.sessionId);
      setOtp(failure.otp);
      setItems(failure.items);
      clearStoredSession();
    } finally {
      setSessionLoading(false);
      isBusyRef.current = false;
      setIsRefreshing(false);
    }
  }, [clearStoredSession, user]);

  const fetchSessionItems = useCallback(
    async (fullRefresh = false) => {
      if (!sessionId) return;

      try {
        const cursor = fullRefresh ? null : lastPollCursorRef.current;
        const res = await fetch(buildPollUrl(sessionId, cursor), { credentials: 'include' });
        if (!res.ok) throw new Error(`Polling failed: ${res.status}`);

        const { items: data, expiresAt, status, label } = parseSessionEnvelope(await res.json());
        if (expiresAt) setSessionExpiresAt(expiresAt);
        if (label !== null || fullRefresh) setSessionLabel(label);

        if (status) {
          setSessionStatus(status);
          if (status === 'completed') {
            clearStoredSession();
            setUiStatus('ready');
            setStatusMessage('Session committed to inventory. View only.');
            setSelectedIds(new Set());
          }
        }

        pollFailCountRef.current = 0;

        const nextCursor = getLatestCursor(data);
        if (nextCursor) {
          lastPollCursorRef.current = nextCursor;
          lastItemAddedAtRef.current = Date.now();
        }

        const nextItems = mergeSessionItems(itemsRef.current, data, fullRefresh || cursor == null);
        setItems(nextItems);
        if (status !== 'completed') {
          setSelectedIds(
            reconcileSelectedIds(
              selectedIdsRef.current,
              nextItems,
              data,
              manuallyDeselectedRef.current
            )
          );
        }

        const alertResult = evaluateSessionDraftAlert({
          incomingCount: data.length,
          sessionStatus: sessionStatusRef.current,
          sessionStartTime: sessionStartTimeRef.current,
          lastLongSessionAlertAt: lastLongSessionAlertRef.current,
          lastItemAddedAt: lastItemAddedAtRef.current,
          idleAlertFired: idleAlertFiredRef.current,
        });
        lastLongSessionAlertRef.current = alertResult.nextLastLongSessionAlertAt;
        idleAlertFiredRef.current = alertResult.nextIdleAlertFired;
        if (alertResult.alert) {
          setDraftAlert(alertResult.alert);
        }

        setPollError(null);
      } catch {
        pollFailCountRef.current += 1;
        const failure = getPollFailureOutcome(pollFailCountRef.current);
        if (failure.shouldStopPolling && pollIntervalRef.current) {
          globalThis.clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        if (failure.uiStatus) setUiStatus(failure.uiStatus);
        if (failure.statusMessage) setStatusMessage(failure.statusMessage);
        setPollError(failure.pollError);
      }
    },
    [clearStoredSession, sessionId]
  );

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      globalThis.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    if (!sessionId) return;
    pollIntervalRef.current = globalThis.setInterval(() => {
      void fetchSessionItems();
    }, 2000);
  }, [sessionId, fetchSessionItems, stopPolling]);

  useEffect(() => {
    const resumeFromParam = async (paramSessionId: string): Promise<boolean> => {
      try {
        const sessionsRes = await fetch('/api/sessions/active', { credentials: 'include' });
        if (sessionsRes.ok) {
          const sessions = await sessionsRes.json();
          const found = sessions.find((s: any) => s.session_id === paramSessionId);
          if (found) {
            const resumed = resolveParamResumeMatch(found, user?.store_id);
            setSessionId(resumed.sessionId);
            setOtp(resumed.otp);
            setSessionStatus(resumed.sessionStatus);
            setSessionLabel(resumed.sessionLabel);
            if (resumed.shouldClearStoredSession) {
              clearStoredSession();
            } else {
              for (const [key, value] of resumed.storageEntries) {
                sessionStorage.setItem(key, value);
              }
            }
            sessionStartTimeRef.current = resumed.sessionStartTime;
            lastItemAddedAtRef.current = resumed.lastItemAddedAt;
            return true;
          }
        }

        const metaRes = await fetch(`/api/session/${paramSessionId}/meta`, {
          credentials: 'include',
        });
        if (metaRes.ok) {
          const meta = await metaRes.json();
          if (meta.status === 'completed') {
            clearStoredSession();
            setSessionId(paramSessionId);
            setSessionStatus('completed');
            setSessionLabel(meta.label ?? null);
            setSessionLoading(false);
            return true;
          }
        }
      } catch {}

      return false;
    };

    const resumeFromStorage = async (savedId: string, savedOtp: string): Promise<boolean> => {
      try {
        const statusRes = await fetch('/api/sessions/active', { credentials: 'include' });
        const activeSessions = statusRes.ok ? await statusRes.json() : [];
        const match = activeSessions.find((s: any) => s.session_id === savedId);

        const res = await fetch(`/api/session/${savedId}`, { credentials: 'include' });
        if (!res.ok) {
          clearStoredSession();
          return false;
        }

        const envelope = parseSessionEnvelope(await res.json());
        const resumed = resolveStoredSessionResume(
          savedId,
          savedOtp,
          envelope,
          match?.status,
          match?.label ?? null,
          manuallyDeselectedRef.current
        );
        if (resumed.kind === 'completed') {
          clearStoredSession();
          return false;
        }

        if (resumed.expiresAt) setSessionExpiresAt(resumed.expiresAt);
        setSessionId(resumed.sessionId);
        setOtp(resumed.otp);
        setSessionStatus(resumed.sessionStatus);
        setSessionLabel(resumed.sessionLabel);
        setItems(resumed.items);
        setUiStatus(resumed.uiStatus);
        setStatusMessage(resumed.statusMessage);
        sessionStartTimeRef.current = resumed.sessionStartTime;
        lastItemAddedAtRef.current = resumed.lastItemAddedAt;
        setSelectedIds(resumed.selectedIds);
        lastPollCursorRef.current = resumed.lastPollCursor;
        return true;
      } catch {}

      return false;
    };

    void (async () => {
      const paramSessionId = searchParams.get('session');
      if (paramSessionId && (await resumeFromParam(paramSessionId))) return;

      const savedId = sessionStorage.getItem('scan_session_id');
      const savedOtp = sessionStorage.getItem('scan_otp');
      const savedStoreId = sessionStorage.getItem('scan_store_id');
      const storeIdMismatch = shouldClearStoredSessionForStore(savedStoreId, user?.store_id);

      if (storeIdMismatch) {
        clearStoredSession();
      }

      if (savedId && savedOtp && !storeIdMismatch && (await resumeFromStorage(savedId, savedOtp))) {
        return;
      }

      createSession();
    })();

    return () => {
      stopPolling();
    };
  }, [clearStoredSession, createSession, stopPolling, searchParams, user?.store_id]);

  useEffect(() => {
    const action = getSessionActivationAction(sessionId, sessionStatus);
    if (action === 'stop') {
      stopPolling();
      return;
    }

    lastPollCursorRef.current = null;
    void fetchSessionItems(true);

    if (action === 'poll') {
      startPolling();
    } else {
      stopPolling();
    }

    return () => {
      stopPolling();
    };
  }, [sessionId, sessionStatus, fetchSessionItems, startPolling, stopPolling]);

  const toggleItem = (id: number) =>
    setSelectedIds(prev => {
      const result = toggleSessionSelection(prev, id, manuallyDeselectedRef.current);
      manuallyDeselectedRef.current = result.manuallyDeselected;
      return result.selectedIds;
    });

  const handleResetSession = async () => {
    if (isBusyRef.current) return;
    setIsRefreshing(true);
    stopPolling();
    await createSession();
  };

  return {
    sessionId,
    otp,
    items,
    setItems,
    sessionStatus,
    setSessionStatus,
    sessionLabel,
    setSessionLabel,
    sessionExpiresAt,
    selectedIds,
    setSelectedIds,
    uiStatus,
    setUiStatus,
    statusMessage,
    setStatusMessage,
    sessionLoading,
    pollError,
    isRefreshing,
    draftAlert,
    setDraftAlert,
    isBusyRef,
    manuallyDeselectedRef,
    lastPollCursorRef,
    sessionStartTimeRef,
    idleAlertFiredRef,
    lastLongSessionAlertRef,
    createSession,
    fetchSessionItems,
    startPolling,
    stopPolling,
    toggleItem,
    handleResetSession,
  };
}
