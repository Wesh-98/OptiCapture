import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { SessionItem, UiStatus } from '../components/scan/types';

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function buildPollUrl(sessionId: string, sinceId: number | null): string {
  return sinceId != null
    ? `/api/session/${sessionId}?since_id=${sinceId}`
    : `/api/session/${sessionId}`;
}

export function parseSessionEnvelope(raw: unknown): { items: SessionItem[]; expiresAt: string | null } {
  if (Array.isArray(raw)) return { items: raw as SessionItem[], expiresAt: null };
  const obj = raw as { items?: SessionItem[]; expires_at?: string };
  return { items: obj.items ?? [], expiresAt: obj.expires_at ?? null };
}

export function mergeSessionItems(
  prevItems: SessionItem[],
  incoming: SessionItem[],
  isFullRefresh: boolean,
): SessionItem[] {
  if (isFullRefresh) return incoming;
  if (incoming.length === 0) return prevItems;
  const incomingIds = new Set(incoming.map(i => i.id));
  return [...incoming, ...prevItems.filter(i => !incomingIds.has(i.id))];
}

export function autoSelectIncoming(
  prev: Set<number>,
  incoming: SessionItem[],
  manuallyDeselected: Set<number>,
): Set<number> {
  const next = new Set(prev);
  for (const item of incoming) {
    if (item.lookup_status === 'new_candidate' && !item.exists_in_inventory && !manuallyDeselected.has(item.id)) {
      next.add(item.id);
    }
  }
  return next;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useScanSession(addToast: (type: 'success' | 'error' | 'warning', message: string) => void) {
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
  const [draftAlert, setDraftAlert] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isBusyRef = useRef(false);
  const pollFailCountRef = useRef(0);
  const lastPollAtRef = useRef<number | null>(null);
  const manuallyDeselectedRef = useRef<Set<number>>(new Set());
  const sessionStartTimeRef = useRef<number | null>(null);
  const lastItemAddedAtRef = useRef<number | null>(null);
  const idleAlertFiredRef = useRef(false);
  const lastLongSessionAlertRef = useRef<number | null>(null);
  const sessionStatusRef = useRef<'active' | 'draft' | 'completed' | null>(null);
  const expiryWarnedRef = useRef(false);

  useEffect(() => {
    sessionStatusRef.current = sessionStatus;
  }, [sessionStatus]);

  // Warn when session expires in < 30 min
  useEffect(() => {
    if (!sessionExpiresAt || sessionStatus !== 'active') return;
    expiryWarnedRef.current = false;
    const check = () => {
      if (expiryWarnedRef.current) return;
      const msLeft = new Date(sessionExpiresAt).getTime() - Date.now();
      if (msLeft > 0 && msLeft < 30 * 60 * 1000) {
        expiryWarnedRef.current = true;
        addToast('warning', `Session expires in ${Math.ceil(msLeft / 60000)} min — save as draft or commit soon`);
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
    manuallyDeselectedRef.current = new Set();

    try {
      const res = await fetch('/api/session/create', { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error(`Session creation failed: ${res.status}`);
      const data = await res.json();
      setSessionId(data.sessionId);
      setOtp(data.otp);
      setSessionStatus('active');
      sessionStartTimeRef.current = Date.now();
      lastItemAddedAtRef.current = Date.now();
      idleAlertFiredRef.current = false;
      lastLongSessionAlertRef.current = null;
      setItems([]);
      setUiStatus('ready');
      setStatusMessage('Session ready. Scan the QR code with your phone.');
      sessionStorage.setItem('scan_session_id', data.sessionId);
      sessionStorage.setItem('scan_otp', data.otp);
      if (user?.store_id != null) sessionStorage.setItem('scan_store_id', String(user.store_id));
    } catch {
      setUiStatus('error');
      setStatusMessage('Could not create scan session.');
      setSessionId(null);
      setOtp(null);
      setItems([]);
    } finally {
      setSessionLoading(false);
      isBusyRef.current = false;
      setIsRefreshing(false);
    }
  }, [user]);

  const fetchSessionItems = useCallback(async (fullRefresh = false) => {
    if (!sessionId) return;
    try {
      const sinceId = fullRefresh ? null : lastPollAtRef.current;
      const res = await fetch(buildPollUrl(sessionId, sinceId), { credentials: 'include' });
      if (!res.ok) throw new Error(`Polling failed: ${res.status}`);
      const { items: data, expiresAt } = parseSessionEnvelope(await res.json());
      if (expiresAt) setSessionExpiresAt(expiresAt);
      pollFailCountRef.current = 0;

      if (data.length > 0) {
        const maxId = data.reduce((max, item) => (item.id > max ? item.id : max), 0);
        if (maxId > (lastPollAtRef.current ?? 0)) lastPollAtRef.current = maxId;
        lastItemAddedAtRef.current = Date.now();
      }

      setItems(prev => mergeSessionItems(prev, data, fullRefresh || sinceId == null));
      setSelectedIds(prev => autoSelectIncoming(prev, data, manuallyDeselectedRef.current));

      const checkAlerts = () => {
        if (!data.length || sessionStatusRef.current !== 'active') return;
        if (sessionStartTimeRef.current) {
          const sessionAge = Date.now() - sessionStartTimeRef.current;
          const thirtyMin = 30 * 60 * 1000;
          const tooSoon = lastLongSessionAlertRef.current != null && Date.now() - lastLongSessionAlertRef.current < thirtyMin;
          if (sessionAge >= thirtyMin && !tooSoon) {
            lastLongSessionAlertRef.current = Date.now();
            setDraftAlert({ message: `You've been scanning for ${Math.floor(sessionAge / 60000)} min — save as draft to protect your progress.`, visible: true });
          }
        }
        if (lastItemAddedAtRef.current && !idleAlertFiredRef.current && Date.now() - lastItemAddedAtRef.current > 10 * 60 * 1000) {
          idleAlertFiredRef.current = true;
          setDraftAlert({ message: 'No new items scanned for 10 min — save as draft to protect your progress.', visible: true });
        }
      };
      checkAlerts();
      setPollError(null);
    } catch {
      pollFailCountRef.current += 1;
      if (pollFailCountRef.current >= 3) {
        if (pollIntervalRef.current) {
          globalThis.clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setUiStatus('error');
        setStatusMessage('Server is offline or unreachable.');
        setPollError('Server offline — polling stopped. Restart the server and refresh.');
      } else {
        setPollError('Could not refresh live scan feed.');
      }
    }
  }, [sessionId, addToast]);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      globalThis.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    if (!sessionId) return;
    pollIntervalRef.current = globalThis.setInterval(() => { fetchSessionItems(); }, 2000);
  }, [sessionId, fetchSessionItems, stopPolling]);

  // Init effect: resume from URL param / sessionStorage or create fresh
  useEffect(() => {
    const resumeFromParam = async (paramSessionId: string): Promise<boolean> => {
      try {
        const sessionsRes = await fetch('/api/sessions/active', { credentials: 'include' });
        if (sessionsRes.ok) {
          const sessions = await sessionsRes.json();
          const found = sessions.find((s: any) => s.session_id === paramSessionId);
          if (found) {
            setSessionId(found.session_id);
            setOtp(found.otp);
            setSessionStatus(found.status);
            setSessionLabel(found.label ?? null);
            if (found.status !== 'completed') {
              sessionStorage.setItem('scan_session_id', found.session_id);
              sessionStorage.setItem('scan_otp', found.otp);
            }
            sessionStartTimeRef.current = Date.now();
            lastItemAddedAtRef.current = Date.now();
            return true;
          }
        }
        const metaRes = await fetch(`/api/session/${paramSessionId}/meta`, { credentials: 'include' });
        if (metaRes.ok) {
          const meta = await metaRes.json();
          if (meta.status === 'completed') {
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
          sessionStorage.removeItem('scan_session_id');
          sessionStorage.removeItem('scan_otp');
          sessionStorage.removeItem('scan_store_id');
          return false;
        }
        const { items: data, expiresAt } = parseSessionEnvelope(await res.json());
        if (expiresAt) setSessionExpiresAt(expiresAt);
        setSessionId(savedId);
        setOtp(savedOtp);
        setSessionStatus(match?.status ?? 'active');
        setSessionLabel(match?.label ?? null);
        setItems(data);
        setUiStatus('ready');
        setStatusMessage('Session resumed. Scan the QR code with your phone.');
        sessionStartTimeRef.current = Date.now();
        lastItemAddedAtRef.current = Date.now();
        setSelectedIds(new Set(
          data.filter((i: any) => i.lookup_status === 'new_candidate' && !i.exists_in_inventory).map((i: any) => i.id)
        ));
        return true;
      } catch {}
      return false;
    };

    (async () => {
      const paramSessionId = searchParams.get('session');
      if (paramSessionId && await resumeFromParam(paramSessionId)) return;

      const savedId = sessionStorage.getItem('scan_session_id');
      const savedOtp = sessionStorage.getItem('scan_otp');
      const savedStoreId = sessionStorage.getItem('scan_store_id');
      const storeIdMismatch = savedStoreId != null && user?.store_id != null && String(user.store_id) !== savedStoreId;
      if (storeIdMismatch) {
        sessionStorage.removeItem('scan_session_id');
        sessionStorage.removeItem('scan_otp');
        sessionStorage.removeItem('scan_store_id');
      }
      if (savedId && savedOtp && !storeIdMismatch && await resumeFromStorage(savedId, savedOtp)) return;
      createSession();
    })();

    return () => { stopPolling(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createSession, stopPolling, searchParams]);

  // Start/stop polling when sessionId changes
  useEffect(() => {
    if (!sessionId) { stopPolling(); return; }
    lastPollAtRef.current = null;
    fetchSessionItems(true);
    startPolling();
    return () => { stopPolling(); };
  }, [sessionId, fetchSessionItems, startPolling, stopPolling]);

  const toggleItem = (id: number) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) {
      next.delete(id);
      manuallyDeselectedRef.current.add(id);
    } else {
      next.add(id);
      manuallyDeselectedRef.current.delete(id);
    }
    return next;
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
    lastPollAtRef,
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
