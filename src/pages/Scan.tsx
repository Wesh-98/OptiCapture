import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Smartphone,
  RefreshCw,
  Save,
  Image as ImageIcon,
  Loader2,
  Wifi,
  ShieldCheck,
  AlertTriangle,
  Pencil,
  Trash2,
  X,
  ScanBarcode,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../context/AuthContext';

interface SessionItem {
  id: number;
  upc: string;
  quantity: number;
  product_name: string | null;
  brand: string | null;
  image: string | null;
  scanned_at: string;
  lookup_status: string;
  source: string | null;
  exists_in_inventory: number;
  sale_price: number | null;
  unit: string | null;
}

interface ServerInfo {
  ip: string;
  port: number;
  protocol: string;
  mobileUrl?: string;
  tunnelUrl?: string | null;
}

interface EditDraft {
  id: number;
  product_name: string;
  brand: string;
  quantity: number;
  upc: string;
  image: string;   // base64 data URL or existing URL or ''
  tag_names: string;
  sale_price: string;   // add this
  unit: string;          // add this
}

interface Category {
  id: number;
  name: string;
  icon: string;
  status: string;
}

interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning';
  message: string;
}

type UiStatus = 'idle' | 'loading' | 'ready' | 'error' | 'committing';

function StatusBadge({ item }: Readonly<{ item: SessionItem }>) {
  if (item.exists_in_inventory === 1) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">In Stock</span>;
  }
  if (item.lookup_status === 'new_candidate') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">New</span>;
  }
  return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Unknown</span>;
}

function SourcePill({ source }: Readonly<{ source: string | null }>) {
  if (!source || source === 'scan_only') return null;
  const label =
    source === 'open_food_facts' ? 'OFF' :
    source === 'upcitemdb' ? 'UPC DB' :
    source === 'inventory' ? 'Inventory' : source;
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-100 text-slate-500 border border-slate-200">
      {label}
    </span>
  );
}

function defaultDraftName(): string {
  const now = new Date();
  const day = now.toLocaleDateString('en-US', { weekday: 'short' });
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `Scan · ${day} ${time}`;
}

// ─── Poll helpers (pure, no React deps) ─────────────────────────────────────

function buildPollUrl(sessionId: string, sinceId: number | null): string {
  return sinceId != null
    ? `/api/session/${sessionId}?since_id=${sinceId}`
    : `/api/session/${sessionId}`;
}

function parseSessionEnvelope(raw: unknown): { items: SessionItem[]; expiresAt: string | null } {
  if (Array.isArray(raw)) return { items: raw as SessionItem[], expiresAt: null };
  const obj = raw as { items?: SessionItem[]; expires_at?: string };
  return { items: obj.items ?? [], expiresAt: obj.expires_at ?? null };
}

function mergeSessionItems(
  prevItems: SessionItem[],
  incoming: SessionItem[],
  isFullRefresh: boolean,
): SessionItem[] {
  if (isFullRefresh) return incoming;
  if (incoming.length === 0) return prevItems;
  const incomingIds = new Set(incoming.map(i => i.id));
  return [...incoming, ...prevItems.filter(i => !incomingIds.has(i.id))];
}

function autoSelectIncoming(
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

export default function Scan() {
  const prefersReducedMotion = useReducedMotion();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const isTaker = user?.role === 'taker';

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [otp, setOtp] = useState<string | null>(null);
  const [items, setItems] = useState<SessionItem[]>([]);
  const [sessionStatus, setSessionStatus] = useState<'active' | 'draft' | 'completed' | null>(null);
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);
  const expiryWarnedRef = useRef(false);
  const [showDraftPopover, setShowDraftPopover] = useState(false);
  const [draftNameInput, setDraftNameInput] = useState('');
  const [draftAlert, setDraftAlert] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [uiStatus, setUiStatus] = useState<UiStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('Preparing scanner session...');
  const [ipLoading, setIpLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [editItem, setEditItem] = useState<EditDraft | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [showCommitModal, setShowCommitModal] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  // per-item category assignments used inside the commit modal
  const [itemCategories, setItemCategories] = useState<Map<number, number>>(new Map());
  const [modalSelectedIds, setModalSelectedIds] = useState<Set<number>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState<number | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);

  const [scanInputMode, setScanInputMode] = useState<'mobile' | 'hardware'>(
    () => (sessionStorage.getItem('scan_input_mode') as 'mobile' | 'hardware') ?? 'mobile'
  );
  const [lastHardwareScan, setLastHardwareScan] = useState<string | null>(null);

  useEffect(() => {
    sessionStorage.setItem('scan_input_mode', scanInputMode);
  }, [scanInputMode]);

  useEffect(() => {
    sessionStatusRef.current = sessionStatus;
  }, [sessionStatus]);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isBusyRef = useRef(false);
  const pollFailCountRef = useRef(0);
  const lastPollAtRef = useRef<number | null>(null); // highest item id seen — used as delta cursor
  const manuallyDeselectedRef = useRef<Set<number>>(new Set());
  const sessionStartTimeRef = useRef<number | null>(null);
  const lastItemAddedAtRef = useRef<number | null>(null);
  const idleAlertFiredRef = useRef(false);
  const lastLongSessionAlertRef = useRef<number | null>(null);
  const sessionStatusRef = useRef<'active' | 'draft' | 'completed' | null>(null);
  const lastScannedUpcRef = useRef<string | null>(null);
  const lastScannedAtRef = useRef<number>(0);

  const addToast = useCallback((type: 'success' | 'error' | 'warning', message: string) => {
    const id = Math.random().toString(36).slice(2, 11);
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  // Warn user when session expires in < 30 min
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

  const submitHardwareScan = useCallback(async (upc: string) => {
    if (!sessionId || !otp) return;
    // Dedup: ignore the same UPC scanned within 1.5 s (hardware scanners often fire twice)
    const now = Date.now();
    if (upc === lastScannedUpcRef.current && now - lastScannedAtRef.current < 1500) return;
    lastScannedUpcRef.current = upc;
    lastScannedAtRef.current = now;
    setLastHardwareScan(upc);
    try {
      const res = await fetch(`/api/session/${sessionId}/scan`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upc, otp }),
      });
      if (!res.ok) throw new Error('Scan failed');
      addToast('success', `Scanned: ${upc}`);
    } catch {
      addToast('error', `Failed to record scan for ${upc}`);
    }
  }, [sessionId, otp, addToast]);

  const fetchCategories = useCallback(async (): Promise<Category[]> => {
    setCategoriesLoading(true);
    try {
      const res = await fetch('/api/categories', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch categories');
      const data: Category[] = await res.json();
      const active = data.filter(c => c.status !== 'Inactive');
      setCategories(active);
      return active;
    } catch {
      addToast('error', 'Failed to load categories');
      return [];
    } finally {
      setCategoriesLoading(false);
    }
  }, [addToast]);

  const fetchServerInfo = useCallback(async () => {
    setIpLoading(true);
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch('/api/server-info', { credentials: 'include', signal: controller.signal });
      if (!res.ok) throw new Error(`Server info request failed: ${res.status}`);
      const data = await res.json();
      setServerInfo({
        ip: data.ip || 'localhost',
        port: data.port || 3000,
        protocol: data.protocol || 'http',
        mobileUrl: data.mobileUrl,
        tunnelUrl: data.tunnelUrl ?? null,
      });
    } catch {
      setServerInfo({ ip: 'localhost', port: 3000, protocol: 'http' });
    } finally {
      globalThis.clearTimeout(timeout);
      setIpLoading(false);
    }
  }, []);

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
      // Save session to sessionStorage for persistence (store_id guards against cross-store leaks)
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

  const handleSaveDraft = async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/session/${sessionId}/status`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft' }),
      });
      if (res.ok) {
        setSessionStatus('draft');
        setDraftAlert({ message: '', visible: false });
        addToast('success', 'Session saved as draft — scanning paused');
      } else {
        const err = await res.json().catch(() => ({}));
        addToast('error', (err as any)?.error || 'Failed to save draft');
      }
    } catch {
      addToast('error', 'Failed to save draft — check your connection');
    }
  };

  // Called from the named-draft popover — sends label along with status change
  const handleConfirmDraft = async (label: string) => {
    if (!sessionId) return;
    setShowDraftPopover(false);
    try {
      const res = await fetch(`/api/session/${sessionId}/status`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft', label: label.trim() || null }),
      });
      if (res.ok) {
        setSessionStatus('draft');
        setSessionLabel(label.trim() || null);
        setDraftAlert({ message: '', visible: false });
        addToast('success', 'Session saved as draft — scanning paused');
      } else {
        const err = await res.json().catch(() => ({}));
        addToast('error', (err as any)?.error || 'Failed to save draft');
      }
    } catch {
      addToast('error', 'Failed to save draft — check your connection');
    }
  };

  const handleResumeScan = async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/session/${sessionId}/status`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      if (res.ok) {
        setSessionStatus('active');
        sessionStartTimeRef.current = Date.now();
        idleAlertFiredRef.current = false;
        lastLongSessionAlertRef.current = null;
        setDraftAlert({ message: '', visible: false });
        addToast('success', 'Scanning resumed — phone can now scan again');
      } else {
        const err = await res.json().catch(() => ({}));
        addToast('error', (err as any)?.error || 'Failed to resume scanning');
      }
    } catch {
      addToast('error', 'Failed to resume scanning — check your connection');
    }
  };

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
  }, [sessionId]);

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

  useEffect(() => {
    fetchServerInfo();
    const serverInfoInterval = globalThis.setInterval(fetchServerInfo, 30_000);

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
        // Not in active/draft list — check if it's a completed session
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

    // Check for ?session= param, then sessionStorage, then create new
    (async () => {
      const paramSessionId = searchParams.get('session');
      if (paramSessionId && await resumeFromParam(paramSessionId)) return;

      const savedId = sessionStorage.getItem('scan_session_id');
      const savedOtp = sessionStorage.getItem('scan_otp');
      const savedStoreId = sessionStorage.getItem('scan_store_id');
      // Guard against cross-store session leaks
      const storeIdMismatch = savedStoreId != null && user?.store_id != null && String(user.store_id) !== savedStoreId;
      if (storeIdMismatch) {
        sessionStorage.removeItem('scan_session_id');
        sessionStorage.removeItem('scan_otp');
        sessionStorage.removeItem('scan_store_id');
      }
      if (savedId && savedOtp && !storeIdMismatch && await resumeFromStorage(savedId, savedOtp)) return;
      createSession();
    })();

    return () => { stopPolling(); globalThis.clearInterval(serverInfoInterval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchServerInfo, createSession, stopPolling, searchParams]);

  useEffect(() => {
    if (!sessionId) { stopPolling(); return; }
    lastPollAtRef.current = null; // reset delta cursor on new session
    fetchSessionItems(true);      // full load first
    startPolling();
    return () => { stopPolling(); };
  }, [sessionId, fetchSessionItems, startPolling, stopPolling]);

  // Hardware scanner keydown listener — only active in hardware mode when session is ready
  useEffect(() => {
    if (scanInputMode !== 'hardware' || !sessionId || !otp || uiStatus !== 'ready') return;

    let buffer = '';
    let lastKeyTime = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      if (now - lastKeyTime > 80) buffer = '';
      lastKeyTime = now;

      if (e.key === 'Enter' && buffer.length >= 4) {
        e.preventDefault();
        submitHardwareScan(buffer);
        buffer = '';
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [scanInputMode, sessionId, otp, uiStatus, submitHardwareScan]);

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

  const openCommitModal = async () => {
    if (!sessionId || selectedIds.size === 0 || isBusyRef.current) return;
    const activeCategories = await fetchCategories();
    if (activeCategories.length === 0) {
      addToast('error', 'No active categories found. Create a category before committing.');
      return;
    }
    // Pre-populate with empty assignments for every selected item
    setItemCategories(new Map());
    setModalSelectedIds(new Set());
    setBulkCategoryId(null);
    setShowCommitModal(true);
  };

  const confirmCommit = async () => {
    if (!sessionId || isBusyRef.current) return;
    // Build assignments — only items that have a category assigned
    const assignments = [...selectedIds]
      .filter(id => itemCategories.has(id))
      .map(id => ({ id, category_id: itemCategories.get(id)! }));
    if (assignments.length === 0) return;
    setShowCommitModal(false);
    isBusyRef.current = true;
    setUiStatus('committing');
    setStatusMessage('Committing selected items to inventory...');
    try {
      const res = await fetch(`/api/session/${sessionId}/commit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      });
      if (!res.ok) throw new Error(`Commit failed: ${res.status}`);
      const result = await res.json();
      const skipped = (result.skippedExisting ?? 0) + (result.skippedUnknown ?? 0);
      let toastMsg: string;
      if (skipped > 0) {
        const dupSuffix = result.skippedExisting !== 1 ? 's' : '';
        toastMsg = `${result.inserted ?? 0} committed — ${result.skippedExisting ?? 0} duplicate${dupSuffix}, ${result.skippedUnknown ?? 0} unknown skipped`;
      } else {
        toastMsg = `${result.inserted ?? 0} item(s) committed to inventory`;
      }
      addToast(result.inserted > 0 ? 'success' : 'warning', toastMsg);
      // Remove only the committed items from the list — keep the session alive
      // so remaining unselected items stay visible and scanning can continue.
      const committedIds = new Set(assignments.map(a => a.id));
      setItems(prev => prev.filter(item => !committedIds.has(item.id)));
      setSelectedIds(new Set());
      setItemCategories(new Map());
      lastPollAtRef.current = null; // force full refresh on next poll
      isBusyRef.current = false;
      setUiStatus('ready');
      setStatusMessage('Session ready. Scan the QR code with your phone.');
    } catch {
      setUiStatus('error');
      setStatusMessage('Failed to commit session.');
      addToast('error', 'Failed to commit items to inventory.');
      isBusyRef.current = false;
    }
  };


  const openEdit = (item: SessionItem) => {
    setEditItem({
      id: item.id,
      product_name: item.product_name || '',
      brand: item.brand || '',
      quantity: item.quantity,
      upc: item.upc || '',
      image: item.image || '',
      tag_names: (item as any).tag_names || '',
      sale_price: String(item.sale_price ?? ''),
      unit: item.unit ?? '',
    });
  };

  const saveEdit = async () => {
    if (!editItem || !sessionId) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/session/${sessionId}/items/${editItem.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: editItem.product_name,
          brand: editItem.brand,
          quantity: editItem.quantity,
          upc: editItem.upc,
          image: editItem.image,
          tag_names: editItem.tag_names,
          sale_price: editItem.sale_price || null,
          unit: editItem.unit || null,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      // Update local state immediately
      setItems(prev => prev.map(i => {
        if (i.id !== editItem.id) return i;
        return {
          ...i,
          product_name: editItem.product_name || null,
          brand: editItem.brand || null,
          quantity: editItem.quantity,
          upc: editItem.upc,
          image: editItem.image || null,
          lookup_status: 'new_candidate',
          sale_price: editItem.sale_price ? Number.parseFloat(editItem.sale_price) : null,
          unit: editItem.unit || null,
        };
      }
      ));
      // Auto-select the edited item since it's now a candidate
      setSelectedIds(prev => new Set([...prev, editItem.id]));
      setEditItem(null);
    } catch {
      addToast('error', 'Failed to save changes.');
    } finally {
      setEditSaving(false);
    }
  };

  const deleteItem = async (itemId: number) => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/session/${sessionId}/items/${itemId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Delete failed');
      setItems(prev => prev.filter(i => i.id !== itemId));
      setSelectedIds(prev => { const next = new Set(prev); next.delete(itemId); return next; });
      manuallyDeselectedRef.current.delete(itemId);
    } catch {
      addToast('error', 'Failed to delete item');
    }
  };

  const handleClearAllItems = async () => {
    if (!sessionId) return;
    if (!globalThis.confirm('Clear all scanned items? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/session/${sessionId}/items`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Clear failed');
      setItems([]);
      setSelectedIds(new Set());
      manuallyDeselectedRef.current.clear();
      addToast('success', 'All items cleared');
    } catch {
      addToast('error', 'Failed to clear items');
    }
  };

  const handleDeleteDraft = async () => {
    if (!sessionId) return;
    if (!globalThis.confirm('Delete this draft entirely? All scanned items will be lost.')) return;
    try {
      const res = await fetch(`/api/session/${sessionId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Delete failed');
      addToast('success', 'Draft deleted');
      // Reset to a fresh session
      await createSession();
    } catch {
      addToast('error', 'Failed to delete draft');
    }
  };

  const mobileUrl = useMemo(() => {
    if (!sessionId || !otp) return '';
    const base = serverInfo?.mobileUrl ?? globalThis.location.origin;
    return `${base}/mobile-scan/${sessionId}?otp=${otp}`;
  }, [sessionId, otp, serverInfo]);

  const newItems = items.filter(i => i.lookup_status === 'new_candidate' && !i.exists_in_inventory);
  const inStockItems = items.filter(i => i.exists_in_inventory === 1);
  const unknownItems = items.filter(i => i.lookup_status !== 'new_candidate' && !i.exists_in_inventory);
  const allSelected = items.length > 0 && items.every(i => selectedIds.has(i.id));

  // Render at most 150 rows — all 1000+ items stay in state for commit, just don't put them all in the DOM
  const RENDER_LIMIT = 150;
  const visibleItems = useMemo(() => items.slice(0, RENDER_LIMIT), [items]);

  return (
    <div className="space-y-6">
      {showDraftPopover && <div role="presentation" aria-hidden="true" className="fixed inset-0 z-20" onClick={() => setShowDraftPopover(false)} />}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-navy-900">Live Scan Center</h2>
          <p className="text-slate-500">
            {scanInputMode === 'hardware' ? 'Hardware scanner mode — pull the trigger on any barcode' : 'Connect a mobile device to start remote scanning'}
          </p>
        </div>
        <button
          onClick={handleResetSession}
          disabled={sessionLoading || isRefreshing || uiStatus === 'committing'}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isRefreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Reset Session
        </button>
      </div>


      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Scanner Panel */}
        {sessionStatus !== 'draft' && (
          <div className="lg:col-span-1">
          <div className="bg-navy-900 text-white rounded-2xl shadow-xl overflow-hidden relative">
            <div className="absolute top-0 right-0 p-32 bg-navy-800 rounded-full blur-3xl -mr-16 -mt-16 opacity-50 pointer-events-none" />

            {/* Mode tabs */}
            <div className="relative z-10 flex border-b border-navy-700">
              <button
                onClick={() => setScanInputMode('mobile')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-semibold transition-colors',
                  scanInputMode === 'mobile'
                    ? 'bg-navy-800 text-white border-b-2 border-emerald-400'
                    : 'text-navy-300 hover:text-white hover:bg-navy-800/50'
                )}
              >
                <Smartphone size={16} />
                Mobile Scan
              </button>
              <button
                onClick={() => setScanInputMode('hardware')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-semibold transition-colors',
                  scanInputMode === 'hardware'
                    ? 'bg-navy-800 text-white border-b-2 border-emerald-400'
                    : 'text-navy-300 hover:text-white hover:bg-navy-800/50'
                )}
              >
                <ScanBarcode size={16} />
                Attach Scanner
              </button>
            </div>

            {/* Panel content */}
            <div className="relative z-10 p-6 text-center">
              {scanInputMode === 'mobile' ? (
                <>
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-navy-800 mb-4 border border-navy-700">
                    <Smartphone className="text-emerald-400" size={24} />
                  </div>
                  <h3 className="text-lg font-bold mb-2">Connect Mobile</h3>
                  <p className="text-navy-200 text-sm mb-6">
                    Scan this QR code with your phone to start scanning items remotely.
                  </p>
                  <div className="bg-white p-4 rounded-xl inline-block shadow-lg mb-4">
                    {ipLoading || sessionLoading ? (
                      <div className="w-[180px] h-[180px] bg-slate-100 animate-pulse rounded-lg flex items-center justify-center text-xs text-slate-500">
                        Loading...
                      </div>
                    ) : mobileUrl ? (
                      <QRCodeSVG value={mobileUrl} size={180} />
                    ) : (
                      <div className="w-[180px] h-[180px] bg-slate-100 rounded-lg flex items-center justify-center text-xs text-slate-500 px-3 text-center">
                        Could not generate mobile link
                      </div>
                    )}
                  </div>

                  <div className="text-left bg-navy-950/50 p-4 rounded-lg mb-4 space-y-2">
                    <p className="text-xs text-slate-400">Connection Details:</p>
                    <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 break-all">
                      <Wifi size={14} />
                      <span>
                        {serverInfo?.tunnelUrl
                          ? `Tunnel: ${serverInfo.tunnelUrl}`
                          : `Origin: ${globalThis.location.origin}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-mono text-emerald-400">
                      <ShieldCheck size={14} />
                      <span>Protocol: {globalThis.location.protocol.replaceAll(':', '').toUpperCase()}</span>
                    </div>
                    {otp && (
                      <p className="text-xs font-mono text-emerald-400">
                        OTP: <span className="font-bold text-lg tracking-widest">{otp}</span>
                      </p>
                    )}
                    {mobileUrl && (
                      <p className="text-xs font-mono text-emerald-400 break-all">{mobileUrl}</p>
                    )}
                  </div>

                  <div className="flex items-center justify-center gap-2 text-xs text-navy-300 font-mono bg-navy-950/50 py-2 rounded-lg">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    {serverInfo?.ip && serverInfo.ip !== 'localhost' ? 'Network Ready' : 'Local Mode'}
                  </div>
                </>
              ) : (
                <>
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-navy-800 mb-4 border border-navy-700">
                    <ScanBarcode className="text-emerald-400" size={24} />
                  </div>
                  <h3 className="text-lg font-bold mb-2">Hardware Scanner</h3>
                  <p className="text-navy-200 text-sm mb-6">
                    Plug in a USB barcode scanner or pair a Bluetooth scanner, then pull the trigger on any product.
                  </p>

                  {/* Ready indicator */}
                  <div className={cn(
                    'flex flex-col items-center justify-center gap-3 py-8 rounded-xl mb-4',
                    uiStatus === 'ready' ? 'bg-emerald-950/40 border border-emerald-800/50' : 'bg-navy-950/50 border border-navy-700'
                  )}>
                    {uiStatus === 'ready' ? (
                      <>
                        <div className="relative flex items-center justify-center">
                          <div className="absolute w-14 h-14 rounded-full bg-emerald-500/20 animate-ping" />
                          <div className="w-10 h-10 rounded-full bg-emerald-500/30 flex items-center justify-center">
                            <div className="w-4 h-4 rounded-full bg-emerald-400" />
                          </div>
                        </div>
                        <p className="text-emerald-400 font-semibold text-sm">Scanner Ready</p>
                        <p className="text-navy-300 text-xs">Pull the trigger to scan</p>
                      </>
                    ) : uiStatus === 'error' ? (
                      <>
                        <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                          <X size={20} className="text-red-400" />
                        </div>
                        <p className="text-red-400 font-semibold text-sm">Session failed to start</p>
                        <button
                          onClick={handleResetSession}
                          className="mt-1 px-3 py-1.5 bg-navy-700 hover:bg-navy-600 text-white text-xs rounded-lg transition-colors"
                        >
                          Retry
                        </button>
                      </>
                    ) : (
                      <>
                        <Loader2 size={28} className="text-slate-500 animate-spin" />
                        <p className="text-slate-400 text-sm">Waiting for session...</p>
                      </>
                    )}
                  </div>

                  {/* Last scanned */}
                  <div className="bg-navy-950/50 p-4 rounded-lg text-left space-y-1">
                    <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Last Scanned</p>
                    {lastHardwareScan ? (
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                        <p className="font-mono text-emerald-300 text-sm tracking-widest truncate">{lastHardwareScan}</p>
                      </div>
                    ) : (
                      <p className="text-slate-500 text-xs italic">No barcode scanned yet</p>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-center gap-2 text-xs text-navy-300 font-mono bg-navy-950/50 py-2 rounded-lg">
                    <div className={cn('w-2 h-2 rounded-full', uiStatus === 'ready' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600')} />
                    {uiStatus === 'ready' ? 'Listening for scans' : 'Session not ready'}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        )}

        {/* Feed Panel */}
        <div className="lg:col-span-2 flex flex-col h-[780px] bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {/* Feed header */}
          <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
            <div className="flex items-center gap-3">
              <div className="h-8 w-1 bg-emerald-500 rounded-full" />
              <div>
                <h3 className="font-bold text-navy-900">Incoming Feed</h3>
                <p className="text-xs text-slate-500">{items.length} items scanned</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && !isTaker && (
                <button
                  onClick={openCommitModal}
                  disabled={uiStatus === 'committing'}
                  className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-900/20 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {uiStatus === 'committing' ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Save size={18} />
                  )}
                  Commit Selected ({selectedIds.size})
                </button>
              )}
              {sessionStatus === 'active' && items.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => { setDraftNameInput(sessionLabel ?? defaultDraftName()); setShowDraftPopover(true); }}
                    className="px-4 py-2 bg-[#1e3a5f] text-white rounded-xl text-sm font-semibold hover:bg-[#16304f] transition-colors"
                  >
                    Save as Draft
                  </button>
                  {showDraftPopover && (
                    <div className="absolute right-0 top-full mt-2 z-30 bg-white border border-slate-200 rounded-xl shadow-lg p-3 w-64">
                      <p className="text-xs font-semibold text-slate-600 mb-2">Name this draft (optional)</p>
                      <input
                        autoFocus
                        type="text"
                        value={draftNameInput}
                        onChange={e => setDraftNameInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { handleConfirmDraft(draftNameInput); } else if (e.key === 'Escape') { setShowDraftPopover(false); } }}
                        placeholder="e.g. Morning scan · Aisle 3"
                        className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 mb-2"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleConfirmDraft(draftNameInput)}
                          className="flex-1 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700"
                        >
                          Save Draft
                        </button>
                        <button
                          onClick={() => setShowDraftPopover(false)}
                          className="px-3 py-1.5 border border-slate-200 text-slate-500 rounded-lg text-xs hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {sessionStatus === 'draft' && (
                <button
                  onClick={handleResumeScan}
                  className="px-4 py-2 border border-amber-300 text-amber-700 rounded-xl text-sm font-semibold hover:bg-amber-50 transition-colors"
                >
                  Resume Scanning
                </button>
              )}
            </div>
          </div>

          {/* Status + counts bar */}
          <div className="px-4 py-2.5 border-b border-slate-100 bg-white flex flex-wrap items-center gap-3 text-sm">
            <span className={cn(
              'px-2.5 py-1 rounded-full font-medium text-xs',
              uiStatus === 'error' ? 'bg-red-50 text-red-600'
              : uiStatus === 'committing' ? 'bg-amber-50 text-amber-700'
              : uiStatus === 'ready' ? 'bg-emerald-50 text-emerald-700'
              : 'bg-slate-100 text-slate-600'
            )}>
              {statusMessage}
            </span>
            {items.length > 0 && (
              <>
                <button
                  onClick={() => allSelected ? setSelectedIds(new Set()) : setSelectedIds(new Set(items.map(i => i.id)))}
                  className="text-xs text-slate-500 hover:text-navy-900 underline underline-offset-2"
                >
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
                <button
                  onClick={() => setSelectedIds(new Set(newItems.map(i => i.id)))}
                  className="text-xs text-emerald-600 hover:text-emerald-800 underline underline-offset-2"
                >
                  New Only
                </button>
                <span className="text-xs text-emerald-700 font-semibold">New: {newItems.length}</span>
                <span className="text-xs text-slate-600 font-semibold">In Stock: {inStockItems.length}</span>
                <span className="text-xs text-amber-700 font-semibold">Unknown: {unknownItems.length}</span>
              </>
            )}
            {pollError && (
              <span className="inline-flex items-center gap-1 text-xs text-red-600 ml-auto">
                <AlertTriangle size={13} />
                {pollError}
              </span>
            )}
          </div>

          {/* Draft alert banner */}
          {draftAlert.visible && (
            <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 mx-4">
              <span className="flex-1">{draftAlert.message}</span>
              <button
                onClick={handleSaveDraft}
                className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 shrink-0"
              >
                Save as Draft
              </button>
              <button
                onClick={() => setDraftAlert({ message: '', visible: false })}
                className="text-amber-600 hover:text-amber-800 shrink-0 text-lg leading-none"
              >
                ×
              </button>
            </div>
          )}

          {/* Committed (read-only) banner */}
          {sessionStatus === 'completed' && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm mx-4" style={{ background: '#eef2f8', border: '1px solid #b6c8e0', color: '#1e3a5f' }}>
              <span className="text-lg">✅</span>
              <span className="flex-1">
                {sessionLabel
                  ? <><strong>{sessionLabel}</strong> — committed to inventory. View only.</>
                  : 'This session has been committed to inventory — view only.'}
              </span>
            </div>
          )}

          {/* Draft mode banner */}
          {sessionStatus === 'draft' && (
            <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 mx-4">
              <span className="text-lg">🔒</span>
              <span className="flex-1">
                {sessionLabel
                  ? <><strong>{sessionLabel}</strong> — draft, scanning paused.</>
                  : 'Draft — scanning paused. Edit items below, then commit or resume scanning.'}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleClearAllItems}
                  className="px-3 py-1.5 border border-amber-300 text-amber-700 rounded-lg text-xs font-semibold hover:bg-amber-100 transition-colors"
                >
                  Clear Items
                </button>
                <button
                  onClick={handleDeleteDraft}
                  className="px-3 py-1.5 border border-red-300 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-50 transition-colors"
                >
                  Delete Draft
                </button>
                <button
                  onClick={handleResumeScan}
                  className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 transition-colors"
                >
                  Resume Scanning
                </button>
              </div>
            </div>
          )}

          {/* Item list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50">
            <AnimatePresence mode="popLayout">
              {items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center px-6">
                  {scanInputMode === 'hardware' ? (
                    <>
                      <ScanBarcode size={36} className="mb-3 text-slate-300" />
                      <p className="font-medium">Ready for scans...</p>
                      <p className="text-sm text-slate-400 mt-1">
                        Scanner is listening. Pull the trigger on any barcode to add items.
                      </p>
                    </>
                  ) : (
                    <>
                      <Smartphone size={36} className="mb-3 text-slate-300" />
                      <p className="font-medium">Ready for scans...</p>
                      <p className="text-sm text-slate-400 mt-1">
                        Use the QR code on the left to connect your phone and start scanning items.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                visibleItems.map(item => {
                  const selected = selectedIds.has(item.id);
                  return (
                    <motion.div
                      key={item.id}
                      initial={prefersReducedMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
                      animate={prefersReducedMotion ? {} : { opacity: 1, y: 0, scale: 1 }}
                      exit={prefersReducedMotion ? {} : { opacity: 0, y: -8 }}
                      layout
                      className={cn(
                        'bg-white rounded-xl border transition-all',
                        selected && item.exists_in_inventory ? 'border-slate-400 shadow-sm'
                        : selected ? 'border-emerald-400 shadow-sm shadow-emerald-50 ring-1 ring-emerald-100'
                        : 'border-slate-300'
                      )}
                    >
                      <div className="flex items-start gap-2 p-2">
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleItem(item.id)}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 shrink-0 cursor-pointer"
                        />

                        {/* Image */}
                        <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200 shrink-0">
                          {item.image ? (
                            <img src={item.image} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <ImageIcon size={16} className="text-slate-400" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-navy-900 text-sm leading-tight">
                              {item.product_name || (
                                <span className="text-slate-400 italic">No product name</span>
                              )}
                            </p>
                            <div className="flex items-center gap-2 shrink-0">
                              <StatusBadge item={item} />
                              {sessionStatus !== 'completed' && (<>
                                <button
                                  onClick={() => openEdit(item)}
                                  className="p-1 text-slate-400 hover:text-navy-700 hover:bg-slate-100 rounded transition-colors"
                                  title="Edit item"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  onClick={() => deleteItem(item.id)}
                                  className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                  title="Remove from session"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </>)}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {item.brand && (
                              <span className="text-xs text-slate-500">{item.brand}</span>
                            )}
                            {item.brand && <span className="text-slate-300">·</span>}
                            <SourcePill source={item.source} />
                          </div>

                          <div className="grid grid-cols-2 gap-x-4 mt-1.5 text-xs text-slate-500">
                            <div>
                              <span className="text-slate-600 uppercase text-[10px] font-semibold tracking-wider">UPC</span>
                              <p className="font-mono text-slate-700 truncate">{item.upc}</p>
                            </div>
                            <div>
                              <span className="text-slate-600 uppercase text-[10px] font-semibold tracking-wider">Scanned</span>
                              <p className="text-slate-700">{new Date(item.scanned_at).toLocaleTimeString()}</p>
                            </div>
                          </div>
                        </div>

                        {/* Qty badge */}
                        <div className="shrink-0 px-2.5 py-1 bg-navy-50 text-navy-700 rounded-lg font-mono font-bold text-sm self-center">
                          ×{item.quantity}
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </AnimatePresence>
            {items.length > RENDER_LIMIT && (
              <div className="py-3 text-center text-xs text-slate-400">
                Showing {RENDER_LIMIT} of {items.length} items — all items included in commit
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      <AnimatePresence>
        {editItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }}
              animate={prefersReducedMotion ? {} : { opacity: 1, scale: 1 }}
              exit={prefersReducedMotion ? {} : { opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
            >
              <div className="p-5 border-b border-slate-200 flex justify-between items-center">
                <h3 className="text-lg font-bold text-navy-900">Edit Item</h3>
                <button onClick={() => setEditItem(null)} className="text-slate-400 hover:text-slate-600">
                  <X size={20} />
                </button>
              </div>
              <div className="p-5 space-y-4 overflow-y-auto max-h-[90vh]">
                <div>
                  <label htmlFor="scan-edit-name" className="block text-sm font-medium text-slate-700 mb-1">Product Name</label>
                  <input
                    id="scan-edit-name"
                    type="text"
                    value={editItem.product_name}
                    onChange={e => setEditItem({ ...editItem, product_name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                    placeholder="Enter product name"
                  />
                </div>
                <div>
                  <label htmlFor="scan-edit-brand" className="block text-sm font-medium text-slate-700 mb-1">Brand</label>
                  <input
                    id="scan-edit-brand"
                    type="text"
                    value={editItem.brand}
                    onChange={e => setEditItem({ ...editItem, brand: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                    placeholder="Brand (optional)"
                  />
                </div>
                <div>
                  <label htmlFor="scan-edit-qty" className="block text-sm font-medium text-slate-700 mb-1">Quantity</label>
                  <input
                    id="scan-edit-qty"
                    type="number"
                    min="1"
                    value={editItem.quantity}
                    onChange={e => setEditItem({ ...editItem, quantity: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                  />
                </div>

                {/* Sale Price */}
                <div>
                  <label htmlFor="scan-edit-price" className="block text-sm font-medium text-slate-700 mb-1">Sale Price</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                    <input
                      id="scan-edit-price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={editItem.sale_price}
                      onChange={e => setEditItem({ ...editItem, sale_price: e.target.value })}
                      className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                {/* Unit */}
                <div>
                  <label htmlFor="scan-edit-unit" className="block text-sm font-medium text-slate-700 mb-1">Unit</label>
                  <input
                    id="scan-edit-unit"
                    type="text"
                    list="unit-options"
                    value={editItem.unit}
                    onChange={e => setEditItem({ ...editItem, unit: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent bg-white"
                    placeholder="e.g. each, kg, 500ml, 6-pack"
                  />
                  <datalist id="unit-options">
                    <option value="each" />
                    <option value="kg" />
                    <option value="lb" />
                    <option value="g" />
                    <option value="oz" />
                    <option value="L" />
                    <option value="ml" />
                    <option value="pack" />
                    <option value="box" />
                    <option value="case" />
                    <option value="dozen" />
                    <option value="pair" />
                    <option value="roll" />
                    <option value="bag" />
                  </datalist>
                </div>
                <div>
                  <label htmlFor="scan-edit-upc" className="block text-sm font-medium text-slate-700 mb-1">UPC / Barcode</label>
                  <input
                    id="scan-edit-upc"
                    type="text"
                    value={editItem.upc}
                    onChange={e => setEditItem({ ...editItem, upc: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                    placeholder="UPC or barcode"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Product Image</label>
                  {editItem.image ? (
                    <div className="flex items-center gap-3">
                      <img
                        src={editItem.image}
                        alt="Product"
                        className="w-[60px] h-[60px] object-contain rounded-lg border border-slate-200"
                      />
                      <button
                        onClick={() => setEditItem({ ...editItem, image: '' })}
                        className="flex items-center justify-center w-6 h-6 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                        title="Remove image"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              const result = event.target?.result as string;
                              setEditItem({ ...editItem, image: result });
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div className="w-full px-3 py-8 border-2 border-dashed border-slate-300 rounded-lg text-center text-slate-500 hover:border-slate-400 transition-colors cursor-pointer">
                        Click to upload image
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <label htmlFor="scan-edit-tags" className="block text-sm font-medium text-slate-700 mb-1">Tags</label>
                  <textarea
                    id="scan-edit-tags"
                    rows={2}
                    value={editItem.tag_names}
                    onChange={e => setEditItem({ ...editItem, tag_names: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent resize-none"
                    placeholder="e.g. organic, gluten-free, sale"
                  />
                </div>
              </div>
              <div className="p-5 border-t border-slate-200 flex justify-end gap-3">
                <button
                  onClick={() => setEditItem(null)}
                  className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={editSaving || !editItem.product_name.trim()}
                  className="px-4 py-2 bg-navy-900 text-white font-medium rounded-lg hover:bg-navy-800 transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {editSaving && <Loader2 size={14} className="animate-spin" />}
                  Save
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Commit Modal */}
      <AnimatePresence>
        {showCommitModal && (() => {
          const commitItems = items.filter(i => selectedIds.has(i.id));
          const assignedCount = commitItems.filter(i => itemCategories.has(i.id)).length;
          const unassigned = commitItems.filter(i => !itemCategories.has(i.id));
          const modalAllSelected = commitItems.length > 0 && commitItems.every(i => modalSelectedIds.has(i.id));

          const applyBulk = () => {
            if (!bulkCategoryId) return;
            setItemCategories(prev => {
              const next = new Map(prev);
              const targets = modalSelectedIds.size > 0 ? [...modalSelectedIds] : commitItems.map(i => i.id);
              targets.forEach(id => next.set(id, bulkCategoryId));
              return next;
            });
            setModalSelectedIds(new Set());
          };

          return (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
              initial={prefersReducedMotion ? false : { opacity: 0 }} animate={prefersReducedMotion ? {} : { opacity: 1 }} exit={prefersReducedMotion ? {} : { opacity: 0 }}
              onClick={() => setShowCommitModal(false)}
            >
              <motion.div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]"
                initial={prefersReducedMotion ? false : { scale: 0.95, opacity: 0 }} animate={prefersReducedMotion ? {} : { scale: 1, opacity: 1 }} exit={prefersReducedMotion ? {} : { scale: 0.95, opacity: 0 }}
                onClick={e => e.stopPropagation()}
              >
                {/* Header */}
                <div className="px-6 pt-5 pb-4 border-b border-slate-100">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-navy-900">Commit to Inventory</h3>
                      <p className="text-sm text-slate-500 mt-0.5">{commitItems.length} item{commitItems.length !== 1 ? 's' : ''} selected — assign a category to each</p>
                    </div>
                    <button onClick={() => setShowCommitModal(false)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400">
                      <X size={18} />
                    </button>
                  </div>

                  {/* Bulk assign row */}
                  <div className="flex items-center gap-2 mt-3">
                    <select
                      value={bulkCategoryId ?? ''}
                      onChange={e => setBulkCategoryId(Number(e.target.value) || null)}
                      className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy-700"
                    >
                      <option value="">— Apply category to {modalSelectedIds.size > 0 ? `${modalSelectedIds.size} checked` : 'all'} —</option>
                      {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                    </select>
                    <button
                      onClick={applyBulk}
                      disabled={!bulkCategoryId}
                      className="px-3 py-1.5 bg-navy-900 text-white rounded-lg text-sm font-medium hover:bg-navy-800 disabled:opacity-40 transition-colors shrink-0"
                    >
                      Apply
                    </button>
                  </div>
                </div>

                {/* Item list */}
                <div className="overflow-y-auto flex-1">
                  {categoriesLoading ? (
                    <div className="flex items-center justify-center gap-2 text-sm text-slate-400 py-8">
                      <Loader2 size={16} className="animate-spin" /> Loading categories...
                    </div>
                  ) : (
                    <>
                      {/* Select-all row */}
                      <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-3 text-xs text-slate-500 bg-slate-50">
                        <input
                          type="checkbox"
                          checked={modalAllSelected}
                          onChange={() => setModalSelectedIds(modalAllSelected ? new Set() : new Set(commitItems.map(i => i.id)))}
                          className="rounded"
                        />
                        <span>{modalAllSelected ? 'Deselect all' : 'Select all for bulk apply'}</span>
                      </div>

                      {commitItems.map(item => {
                        const catId = itemCategories.get(item.id);
                        const checked = modalSelectedIds.has(item.id);
                        return (
                          <div key={item.id} className={cn('flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 hover:bg-slate-50', checked && 'bg-blue-50/40')}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setModalSelectedIds(prev => {
                                const next = new Set(prev);
                                checked ? next.delete(item.id) : next.add(item.id);
                                return next;
                              })}
                              className="rounded shrink-0"
                            />
                            {item.image
                              ? <img src={item.image} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0 bg-slate-100" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                              : <div className="w-9 h-9 rounded-lg bg-slate-100 shrink-0 flex items-center justify-center"><ImageIcon size={14} className="text-slate-300" /></div>
                            }
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-800 truncate">{item.product_name || item.upc}</p>
                              <p className="text-xs text-slate-400">×{item.quantity}{item.unit ? ` ${item.unit}` : ''}</p>
                            </div>
                            <select
                              value={catId ?? ''}
                              onChange={e => {
                                const val = Number(e.target.value) || undefined;
                                setItemCategories(prev => {
                                  const next = new Map(prev);
                                  val ? next.set(item.id, val) : next.delete(item.id);
                                  return next;
                                });
                              }}
                              className={cn(
                                'text-xs px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-navy-700 bg-white shrink-0 max-w-[140px]',
                                catId ? 'border-slate-300 text-slate-700' : 'border-amber-300 text-amber-600'
                              )}
                            >
                              <option value="">— Pick —</option>
                              {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                            </select>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-100 flex items-center gap-3">
                  {unassigned.length > 0 && (
                    <span className="flex-1 text-xs text-amber-600 flex items-center gap-1">
                      <AlertTriangle size={13} />
                      {unassigned.length} item{unassigned.length !== 1 ? 's' : ''} need a category
                    </span>
                  )}
                  {unassigned.length === 0 && <span className="flex-1 text-xs text-emerald-600">All items have a category ✓</span>}
                  <button onClick={() => setShowCommitModal(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={confirmCommit}
                    disabled={assignedCount === 0 || categoriesLoading}
                    className="px-4 py-2 rounded-lg bg-navy-900 text-white text-sm font-medium hover:bg-navy-800 transition-colors disabled:opacity-50"
                  >
                    Commit {assignedCount > 0 ? `(${assignedCount})` : ''}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Toast Notifications */}
      <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 space-y-2">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
              animate={prefersReducedMotion ? {} : { opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? {} : { opacity: 0, y: -20 }}
              className={cn(
                'px-4 py-3 rounded-lg shadow-lg font-medium text-sm max-w-md',
                toast.type === 'success' && 'bg-emerald-600 text-white',
                toast.type === 'error' && 'bg-red-600 text-white',
                toast.type === 'warning' && 'bg-amber-600 text-white'
              )}
            >
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
