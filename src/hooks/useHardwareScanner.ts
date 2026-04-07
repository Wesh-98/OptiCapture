import { useCallback, useEffect, useRef, useState } from 'react';
import type { UiStatus } from '../components/scan/types';

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

  const lastScannedUpcRef = useRef<string | null>(null);
  const lastScannedAtRef = useRef<number>(0);

  useEffect(() => {
    sessionStorage.setItem('scan_input_mode', scanInputMode);
  }, [scanInputMode]);

  const submitHardwareScan = useCallback(async (upc: string) => {
    if (!sessionId || !otp) return;
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

  // Keydown listener — only active in hardware mode when session is ready
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

  return {
    scanInputMode,
    setScanInputMode,
    lastHardwareScan,
    submitHardwareScan,
  };
}
