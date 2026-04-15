import { useCallback, useEffect, useState } from 'react';
import type { UiStatus } from '../components/scan/types';

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT')
  );
}

// Handles hardware scanner input via a keydown listener, submits scans to the backend,
// and stores the last scanned code for UI display.
// Only active when scanInputMode is 'hardware' and session is ready.
// Scan input mode is persisted in sessionStorage.
export function useHardwareScanner(
  sessionId: string | null,
  otp: string | null,
  uiStatus: UiStatus,
  addToast: (type: 'success' | 'error' | 'warning', message: string) => void,
) {
  const [scanInputMode, setScanInputMode] = useState<'mobile' | 'hardware'>(
    () => (sessionStorage.getItem('scan_input_mode') as 'mobile' | 'hardware') ?? 'mobile'
  );
  const [lastHardwareScan, setLastHardwareScan] = useState<string | null>(null);

  useEffect(() => {
    sessionStorage.setItem('scan_input_mode', scanInputMode);
  }, [scanInputMode]);

  const submitHardwareScan = useCallback(async (upc: string) => {
    if (!sessionId || !otp) return;

    // Hardware scanners already emit a single burst per trigger, so repeated UPCs
    // should immediately increment quantity instead of being time-deduped.
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

  // Keydown listener — only active in hardware mode when session is ready
  useEffect(() => {
    if (scanInputMode !== 'hardware' || !sessionId || !otp || uiStatus !== 'ready') return;

    let buffer = '';
    let lastKeyTime = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      // Let operators type normally into modal fields without the scanner listener
      // stealing those keystrokes and treating Enter as a barcode submit.
      if (isEditableTarget(e.target) || e.altKey || e.ctrlKey || e.metaKey) {
        return;
      }

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

  return {
    scanInputMode,
    setScanInputMode,
    lastHardwareScan,
    submitHardwareScan,
  };
}
