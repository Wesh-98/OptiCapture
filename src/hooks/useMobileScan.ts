import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  MobileScanInputMode,
  ScanToast,
  ScannedItem,
} from '../components/mobile-scan/types';
import { parseServerDate } from '../lib/utils';
import {
  MOBILE_SCAN_ELEMENT_ID,
  MOBILE_SCAN_IDLE_TIMEOUT_MS,
  buildCameraErrorMessage,
  getDeviceId,
  startFallbackScanner,
  startNativeScanner,
  stopScannerResources,
  type ScannerControls,
  type ScannerReader,
} from '../lib/mobileScanScanner';

const CAMERA_REARM_MISS_COUNT = 3;
const MOBILE_SESSION_SYNC_MS = 3000;

interface UseMobileScanOptions {
  sessionId?: string;
  otp: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseScanResponsePayload(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return raw;
  }
}

function readScanErrorMessage(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.error === 'string' ? payload.error : fallback;
}

function normalizeScannedAt(value: unknown): Date {
  return parseServerDate(value);
}

function normalizeQuantity(value: unknown): number {
  const next =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;

  return Number.isFinite(next) && next > 0 ? Math.trunc(next) : 1;
}

function normalizeUnit(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toScannedItem(value: unknown): ScannedItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const upc = typeof value.upc === 'string' ? value.upc : '';
  if (!upc) {
    return null;
  }

  return {
    id: typeof value.id === 'number' ? value.id : Date.now(),
    name:
      typeof value.product_name === 'string' && value.product_name.trim()
        ? value.product_name
        : upc,
    upc,
    unit: normalizeUnit(value.unit),
    ts: normalizeScannedAt(value.scanned_at),
    quantity: normalizeQuantity(value.quantity),
  };
}

function normalizeScannedItems(values: unknown): ScannedItem[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map(toScannedItem)
    .filter((item): item is ScannedItem => item !== null)
    .sort((a, b) => b.ts.getTime() - a.ts.getTime() || b.id - a.id);
}

function countScannedItems(items: ScannedItem[]): number {
  return items.reduce((total, item) => total + item.quantity, 0);
}

function upsertScannedItem(items: ScannedItem[], nextItem: ScannedItem): ScannedItem[] {
  return [nextItem, ...items.filter(item => item.id !== nextItem.id)];
}

export function useMobileScan({ sessionId, otp }: UseMobileScanOptions) {
  const codeReaderRef = useRef<ScannerReader | null>(null);
  const activeControlsRef = useRef<ScannerControls | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProcessingRef = useRef(false);
  const idleDeadlineRef = useRef(0);
  const idleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onScanRef = useRef<(code: string) => Promise<void>>(async () => {});
  const onUndetectedRef = useRef<() => void>(() => {});
  // Keep the last accepted barcode locked until it disappears from frame.
  const activeCameraCodeRef = useRef<string | null>(null);
  const missedDetectionCountRef = useRef(0);
  const lastSessionErrorRef = useRef<string | null>(null);

  const [inputMode, setInputMode] = useState<MobileScanInputMode>('camera');
  const [isProcessing, setIsProcessing] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [manualItemName, setManualItemName] = useState('');
  const [scanCount, setScanCount] = useState(0);
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraIdle, setCameraIdle] = useState(false);
  const [idleProgress, setIdleProgress] = useState(1);
  const [toast, setToast] = useState<ScanToast | null>(null);
  const [isConnected, setIsConnected] = useState(true);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [sessionDraft, setSessionDraft] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const showToast = useCallback((type: ScanToast['type'], message: string) => {
    setToast({ type, message });
    if (toastTimerRef.current) {
      globalThis.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = globalThis.setTimeout(() => setToast(null), 3000);
  }, []);

  const resetIdleTimer = useCallback(() => {
    idleDeadlineRef.current = Date.now() + MOBILE_SCAN_IDLE_TIMEOUT_MS;
    setCameraIdle(false);
    setIdleProgress(1);
  }, []);

  const resetCameraScanLock = useCallback(() => {
    activeCameraCodeRef.current = null;
    missedDetectionCountRef.current = 0;
  }, []);

  const syncSessionSnapshot = useCallback((data: Record<string, unknown>) => {
    const nextItems = normalizeScannedItems(data.items);
    setScannedItems(nextItems);
    setScanCount(countScannedItems(nextItems));
    setSessionDraft(data.status === 'draft');
    setSessionError(null);
    setIsConnected(true);
    setReconnectAttempts(0);
    lastSessionErrorRef.current = null;
  }, []);

  const syncSessionState = useCallback(
    async (showErrorToast = false) => {
      if (!sessionId || !otp) {
        setSessionLoaded(false);
        setSessionDraft(false);
        setSessionError(null);
        setScannedItems([]);
        setScanCount(0);
        return;
      }

      try {
        const res = await fetch(
          `/api/session/${sessionId}/items?otp=${otp}&device_id=${encodeURIComponent(getDeviceId())}`
        );
        const payload = parseScanResponsePayload(await res.text());

        if (!res.ok) {
          const message = readScanErrorMessage(payload, 'Could not refresh scan session.');

          if ([401, 403, 404, 410].includes(res.status)) {
            setSessionDraft(false);
            setSessionError(message);
            if (lastSessionErrorRef.current !== message || showErrorToast) {
              showToast('error', message);
              lastSessionErrorRef.current = message;
            }
          } else {
            setIsConnected(false);
            setReconnectAttempts(prev => prev + 1);
            if (showErrorToast) {
              showToast('error', message);
            }
          }

          return;
        }

        if (!isRecord(payload)) {
          const message = 'Invalid session response.';
          setSessionError(message);
          if (lastSessionErrorRef.current !== message || showErrorToast) {
            showToast('error', message);
            lastSessionErrorRef.current = message;
          }
          return;
        }

        syncSessionSnapshot(payload);
      } catch {
        setIsConnected(false);
        setReconnectAttempts(prev => prev + 1);
        if (showErrorToast) {
          showToast('error', 'Could not refresh scan session.');
        }
      } finally {
        setSessionLoaded(true);
      }
    },
    [otp, sessionId, showToast, syncSessionSnapshot]
  );

  const submitScan = useCallback(
    async (upc: string, itemName?: string) => {
      if (!sessionId) {
        showToast('error', 'Missing session ID');
        isProcessingRef.current = false;
        setIsProcessing(false);
        return;
      }

      try {
        const res = await fetch(`/api/session/${sessionId}/scan`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId() },
          body: JSON.stringify({ upc, otp, item_name: itemName || undefined }),
        });

        const payload = parseScanResponsePayload(await res.text());

        if (!res.ok) {
          const message = readScanErrorMessage(payload, 'Could not add barcode');
          showToast('error', message);
          return;
        }

        setIsConnected(true);
        setReconnectAttempts(0);
        setSessionError(null);
        lastSessionErrorRef.current = null;

        const scannedItem =
          isRecord(payload) && 'item' in payload ? toScannedItem(payload.item) : null;
        const fallbackItem: ScannedItem = {
          id: Date.now(),
          name: itemName?.trim() || upc,
          upc,
          unit: '',
          ts: new Date(),
          quantity: 1,
        };
        const nextItem = scannedItem ?? fallbackItem;

        setScannedItems(prev => upsertScannedItem(prev, nextItem));
        setScanCount(prev => prev + 1);

        if (navigator.vibrate) {
          navigator.vibrate([100, 50, 100]);
        }

        showToast('success', nextItem.name);
      } catch (error) {
        console.error('Submit scan error:', error);
        setIsConnected(false);
        setReconnectAttempts(prev => prev + 1);
        showToast('error', 'Network error while submitting scan');
      } finally {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
    },
    [otp, sessionId, showToast]
  );

  useEffect(() => {
    setSessionLoaded(false);
    setSessionDraft(false);
    setSessionError(null);
    setScannedItems([]);
    setScanCount(0);
    lastSessionErrorRef.current = null;

    if (!sessionId || !otp) {
      return;
    }

    void syncSessionState(true);
    const intervalId = globalThis.setInterval(() => {
      void syncSessionState();
    }, MOBILE_SESSION_SYNC_MS);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [otp, sessionId, syncSessionState]);

  useEffect(() => {
    onScanRef.current = async (code: string) => {
      const cleanCode = code.trim();
      if (!cleanCode || isProcessingRef.current) {
        return;
      }

      if (activeCameraCodeRef.current === cleanCode) {
        missedDetectionCountRef.current = 0;
        return;
      }

      if (import.meta.env.DEV) {
        console.warn('SCANNED CODE:', cleanCode);
      }

      activeCameraCodeRef.current = cleanCode;
      missedDetectionCountRef.current = 0;
      isProcessingRef.current = true;
      setIsProcessing(true);
      resetIdleTimer();

      await submitScan(cleanCode);
    };

    onUndetectedRef.current = () => {
      if (isProcessingRef.current || !activeCameraCodeRef.current) {
        return;
      }

      missedDetectionCountRef.current += 1;
      if (missedDetectionCountRef.current < CAMERA_REARM_MISS_COUNT) {
        return;
      }

      resetCameraScanLock();
    };
  }, [resetCameraScanLock, resetIdleTimer, submitScan]);

  useEffect(() => {
    if (inputMode !== 'camera' || cameraIdle) {
      return;
    }

    idleIntervalRef.current = globalThis.setInterval(() => {
      if (!idleDeadlineRef.current) {
        return;
      }

      const remaining = idleDeadlineRef.current - Date.now();
      const progress = Math.max(0, Math.min(1, remaining / MOBILE_SCAN_IDLE_TIMEOUT_MS));

      setIdleProgress(progress);

      if (progress === 0 && !cameraIdle) {
        setCameraIdle(true);
      }
    }, 250);

    return () => {
      if (idleIntervalRef.current) {
        globalThis.clearInterval(idleIntervalRef.current);
        idleIntervalRef.current = null;
      }
    };
  }, [cameraIdle, inputMode]);

  const stopScanner = useCallback(async () => {
    const controls = activeControlsRef.current;
    const reader = codeReaderRef.current;

    activeControlsRef.current = null;
    codeReaderRef.current = null;
    resetCameraScanLock();

    await stopScannerResources(MOBILE_SCAN_ELEMENT_ID, controls, reader);
    setCameraError(null);
  }, [resetCameraScanLock]);

  const startScanner = useCallback(async () => {
    if (
      inputMode !== 'camera' ||
      !sessionLoaded ||
      sessionDraft ||
      Boolean(sessionError) ||
      codeReaderRef.current ||
      activeControlsRef.current
    ) {
      return;
    }

    setCameraError(null);

    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera requires HTTPS. Open the tunnel URL, not the LAN IP.');
      return;
    }

    try {
      const nativeControls = await startNativeScanner({
        scannerElementId: MOBILE_SCAN_ELEMENT_ID,
        isProcessing: () => isProcessingRef.current,
        onDetected: code => onScanRef.current(code),
        onUndetected: () => onUndetectedRef.current(),
      });

      if (nativeControls) {
        activeControlsRef.current = nativeControls;
        resetIdleTimer();
        return;
      }

      const { controls, reader } = await startFallbackScanner({
        scannerElementId: MOBILE_SCAN_ELEMENT_ID,
        isProcessing: () => isProcessingRef.current,
        onDetected: code => onScanRef.current(code),
        onUndetected: () => onUndetectedRef.current(),
      });

      activeControlsRef.current = controls;
      codeReaderRef.current = reader;
      resetIdleTimer();
    } catch (error) {
      console.error('Camera start error:', error);
      activeControlsRef.current = null;
      codeReaderRef.current = null;
      setCameraError(buildCameraErrorMessage(error));
    }
  }, [inputMode, resetIdleTimer, sessionDraft, sessionError, sessionLoaded]);

  useEffect(() => {
    if (!sessionLoaded) {
      return;
    }

    if (inputMode === 'camera' && !sessionDraft && !sessionError) {
      void startScanner();
    } else {
      void stopScanner();
    }

    return () => {
      void stopScanner();
    };
  }, [inputMode, sessionDraft, sessionError, sessionLoaded, startScanner, stopScanner]);

  useEffect(() => {
    if (cameraIdle && inputMode === 'camera') {
      void stopScanner();
    }
  }, [cameraIdle, inputMode, stopScanner]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        globalThis.clearTimeout(toastTimerRef.current);
      }
      if (idleIntervalRef.current) {
        globalThis.clearInterval(idleIntervalRef.current);
      }
      void stopScanner();
    };
  }, [stopScanner]);

  const handleManualSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const upc = manualInput.trim();
      if (!upc || isProcessingRef.current) {
        return;
      }

      isProcessingRef.current = true;
      setIsProcessing(true);

      await submitScan(upc, manualItemName.trim() || undefined);
      setManualInput('');
      setManualItemName('');
    },
    [manualInput, manualItemName, submitScan]
  );

  const handleResumeCamera = useCallback(async () => {
    setCameraIdle(false);
    resetIdleTimer();
    await startScanner();
  }, [resetIdleTimer, startScanner]);

  const handleResetCamera = useCallback(async () => {
    await stopScanner();
    await new Promise(resolve => globalThis.setTimeout(resolve, 300));
    setCameraError(null);
    setSessionError(null);
    lastSessionErrorRef.current = null;
    await syncSessionState(true);
  }, [stopScanner, syncSessionState]);

  const retryConnection = useCallback(() => {
    setReconnectAttempts(0);
    setIsConnected(true);
    void syncSessionState(true);
  }, [syncSessionState]);

  return {
    scannerElementId: MOBILE_SCAN_ELEMENT_ID,
    inputMode,
    isProcessing,
    manualInput,
    manualItemName,
    scanCount,
    scannedItems,
    cameraError: cameraError ?? sessionError,
    cameraIdle,
    idleProgress,
    toast,
    isConnected,
    reconnectAttempts,
    sessionDraft,
    setInputMode,
    setManualInput,
    setManualItemName,
    handleManualSubmit,
    handleResumeCamera,
    handleResetCamera,
    retryConnection,
  };
}
