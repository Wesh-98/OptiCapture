import { useCallback, useEffect, useState } from 'react';
import type { UiStatus } from '../components/scan/types';

export type HardwareScanInputMode = 'mobile' | 'hardware';
type FetchInit = Parameters<typeof globalThis.fetch>[1];

export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT')
  );
}

export interface HardwareScanBufferState {
  buffer: string;
  lastKeyTime: number;
}

interface ReduceHardwareScanKeyInput {
  key: string;
  now: number;
  editableTarget: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export function reduceHardwareScanKey(
  state: HardwareScanBufferState,
  input: ReduceHardwareScanKeyInput
): {
  nextState: HardwareScanBufferState;
  submittedUpc: string | null;
  shouldPreventDefault: boolean;
} {
  if (input.editableTarget || input.altKey || input.ctrlKey || input.metaKey) {
    return {
      nextState: state,
      submittedUpc: null,
      shouldPreventDefault: false,
    };
  }

  let buffer = state.buffer;
  if (input.now - state.lastKeyTime > 80) {
    buffer = '';
  }

  const nextState: HardwareScanBufferState = {
    buffer,
    lastKeyTime: input.now,
  };

  if (input.key === 'Enter' && buffer.length >= 4) {
    return {
      nextState: { buffer: '', lastKeyTime: input.now },
      submittedUpc: buffer,
      shouldPreventDefault: true,
    };
  }

  if (input.key.length === 1) {
    return {
      nextState: { buffer: buffer + input.key, lastKeyTime: input.now },
      submittedUpc: null,
      shouldPreventDefault: false,
    };
  }

  return {
    nextState,
    submittedUpc: null,
    shouldPreventDefault: false,
  };
}

export function readStoredHardwareScanInputMode(value: string | null): HardwareScanInputMode {
  return value === 'hardware' ? 'hardware' : 'mobile';
}

export function canSubmitHardwareScan(
  sessionId: string | null,
  otp: string | null,
  sessionStatus: 'active' | 'draft' | 'completed' | null
): boolean {
  return Boolean(sessionId && otp) && sessionStatus === 'active';
}

export function shouldListenForHardwareScanner(
  scanInputMode: HardwareScanInputMode,
  sessionId: string | null,
  otp: string | null,
  sessionStatus: 'active' | 'draft' | 'completed' | null,
  uiStatus: UiStatus
): boolean {
  return (
    scanInputMode === 'hardware' &&
    canSubmitHardwareScan(sessionId, otp, sessionStatus) &&
    uiStatus === 'ready'
  );
}

export function buildHardwareScanRequest(
  sessionId: string,
  otp: string,
  upc: string
): {
  url: string;
  init: FetchInit;
} {
  return {
    url: `/api/session/${sessionId}/scan`,
    init: {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upc, otp }),
    },
  };
}

export function getHardwareScanToast(
  success: boolean,
  upc: string
): { type: 'success' | 'error'; message: string } {
  return success
    ? { type: 'success', message: `Scanned: ${upc}` }
    : { type: 'error', message: `Failed to record scan for ${upc}` };
}

// Handles hardware scanner input via a keydown listener, submits scans to the backend,
// and stores the last scanned code for UI display.
// Only active when scanInputMode is 'hardware' and session is ready.
// Scan input mode is persisted in sessionStorage.
export function useHardwareScanner(
  sessionId: string | null,
  otp: string | null,
  sessionStatus: 'active' | 'draft' | 'completed' | null,
  uiStatus: UiStatus,
  addToast: (type: 'success' | 'error' | 'warning', message: string) => void
) {
  const [scanInputMode, setScanInputMode] = useState<HardwareScanInputMode>(() =>
    readStoredHardwareScanInputMode(sessionStorage.getItem('scan_input_mode'))
  );
  const [lastHardwareScan, setLastHardwareScan] = useState<string | null>(null);

  useEffect(() => {
    sessionStorage.setItem('scan_input_mode', scanInputMode);
  }, [scanInputMode]);

  const submitHardwareScan = useCallback(
    async (upc: string) => {
      if (!canSubmitHardwareScan(sessionId, otp, sessionStatus)) return;

      // Hardware scanners already emit a single burst per trigger, so repeated UPCs
      // should immediately increment quantity instead of being time-deduped.
      setLastHardwareScan(upc);
      try {
        const request = buildHardwareScanRequest(sessionId!, otp!, upc);
        const res = await fetch(request.url, request.init);
        if (!res.ok) throw new Error('Scan failed');
        const toast = getHardwareScanToast(true, upc);
        addToast(toast.type, toast.message);
      } catch {
        const toast = getHardwareScanToast(false, upc);
        addToast(toast.type, toast.message);
      }
    },
    [sessionId, otp, sessionStatus, addToast]
  );

  // Keydown listener — only active in hardware mode when session is ready
  useEffect(() => {
    if (!shouldListenForHardwareScanner(scanInputMode, sessionId, otp, sessionStatus, uiStatus)) {
      return;
    }

    let scanState: HardwareScanBufferState = { buffer: '', lastKeyTime: 0 };

    const onKeyDown = (e: KeyboardEvent) => {
      const result = reduceHardwareScanKey(scanState, {
        key: e.key,
        now: Date.now(),
        editableTarget: isEditableTarget(e.target),
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      });
      scanState = result.nextState;

      if (result.shouldPreventDefault) {
        e.preventDefault();
      }

      if (result.submittedUpc) {
        submitHardwareScan(result.submittedUpc);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [scanInputMode, sessionId, otp, sessionStatus, uiStatus, submitHardwareScan]);

  return {
    scanInputMode,
    setScanInputMode,
    lastHardwareScan,
    submitHardwareScan,
  };
}
