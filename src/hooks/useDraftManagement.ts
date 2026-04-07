import type { MutableRefObject } from 'react';
import { useState } from 'react';
import type { SessionItem } from '../components/scan/types';

function defaultDraftName(): string {
  const now = new Date();
  const day = now.toLocaleDateString('en-US', { weekday: 'short' });
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `Scan · ${day} ${time}`;
}

interface DraftManagementDeps {
  sessionId: string | null;
  sessionLabel: string | null;
  setSessionStatus: (s: 'active' | 'draft' | 'completed') => void;
  setSessionLabel: (l: string | null) => void;
  setDraftAlert: (a: { message: string; visible: boolean }) => void;
  setItems: (items: SessionItem[]) => void;
  setSelectedIds: (ids: Set<number>) => void;
  manuallyDeselectedRef: MutableRefObject<Set<number>>;
  sessionStartTimeRef: MutableRefObject<number | null>;
  idleAlertFiredRef: MutableRefObject<boolean>;
  lastLongSessionAlertRef: MutableRefObject<number | null>;
  createSession: () => Promise<void>;
  addToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

export function useDraftManagement(deps: DraftManagementDeps) {
  const {
    sessionId, sessionLabel, setSessionStatus, setSessionLabel,
    setDraftAlert, setItems, setSelectedIds, manuallyDeselectedRef,
    sessionStartTimeRef, idleAlertFiredRef, lastLongSessionAlertRef,
    createSession, addToast,
  } = deps;

  const [showDraftPopover, setShowDraftPopover] = useState(false);
  const [draftNameInput, setDraftNameInput] = useState('');

  const openDraftPopover = () => {
    setDraftNameInput(sessionLabel ?? defaultDraftName());
    setShowDraftPopover(true);
  };

  const patchStatus = async (body: Record<string, unknown>, errorMsg: string): Promise<boolean> => {
    if (!sessionId) return false;
    try {
      const res = await fetch(`/api/session/${sessionId}/status`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      const err = await res.json().catch(() => ({}));
      addToast('error', (err as any)?.error || errorMsg);
    } catch {
      addToast('error', `${errorMsg} — check your connection`);
    }
    return false;
  };

  const handleSaveDraft = async () => {
    if (!await patchStatus({ status: 'draft' }, 'Failed to save draft')) return;
    setSessionStatus('draft');
    setDraftAlert({ message: '', visible: false });
    addToast('success', 'Session saved as draft — scanning paused');
  };

  const handleConfirmDraft = async (label: string) => {
    if (!sessionId) return;
    setShowDraftPopover(false);
    if (!await patchStatus({ status: 'draft', label: label.trim() || null }, 'Failed to save draft')) return;
    setSessionStatus('draft');
    setSessionLabel(label.trim() || null);
    setDraftAlert({ message: '', visible: false });
    addToast('success', 'Session saved as draft — scanning paused');
  };

  const handleResumeScan = async () => {
    if (!await patchStatus({ status: 'active' }, 'Failed to resume scanning')) return;
    setSessionStatus('active');
    sessionStartTimeRef.current = Date.now();
    idleAlertFiredRef.current = false;
    lastLongSessionAlertRef.current = null;
    setDraftAlert({ message: '', visible: false });
    addToast('success', 'Scanning resumed — phone can now scan again');
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
      await createSession();
    } catch {
      addToast('error', 'Failed to delete draft');
    }
  };

  return {
    showDraftPopover,
    setShowDraftPopover,
    draftNameInput,
    setDraftNameInput,
    openDraftPopover,
    handleSaveDraft,
    handleConfirmDraft,
    handleResumeScan,
    handleClearAllItems,
    handleDeleteDraft,
  };
}
