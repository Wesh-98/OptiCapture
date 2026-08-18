import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { MobileScanInputMode, ScanToast, ScannedItem } from '../components/mobile-scan/types';
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

type FetchInit = Parameters<typeof globalThis.fetch>[1];
type MobileSessionStatus = 'active' | 'draft' | 'completed';

interface UseMobileScanOptions {
  sessionId?: string;
  otp: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMobileSessionStatus(value: unknown): value is MobileSessionStatus {
  return value === 'active' || value === 'draft' || value === 'completed';
}

function parseScannedAt(value: unknown, fallback = Date.now()): Date {
  if (typeof value !== 'string' || !value.trim()) {
    return new Date(fallback);
  }

  const trimmed = value.trim();
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)
    ? trimmed
    : `${trimmed.replace(' ', 'T')}Z`;
  const parsed = new Date(normalized);

  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : parsed;
}

export function parseScanResponsePayload(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return raw;
  }
}

export function readScanErrorMessage(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.error === 'string' && payload.error.trim()
    ? payload.error
    : fallback;
}

export function normalizeQuantity(value: unknown): number {
  const numericValue = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(numericValue) || numericValue < 1) {
    return 1;
  }

  return Math.floor(numericValue);
}

export function normalizeUnit(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function toScannedItem(value: unknown, now = Date.now()): ScannedItem | null {
  if (!isRecord(value) || typeof value.upc !== 'string' || !value.upc.trim()) {
    return null;
  }

  const upc = value.upc.trim();
  const productName =
    typeof value.product_name === 'string' && value.product_name.trim()
      ? value.product_name.trim()
      : upc;

  return {
    id: typeof value.id === 'number' ? value.id : now,
    name: productName,
    upc,
    unit: normalizeUnit(value.unit),
    quantity: normalizeQuantity(value.quantity),
    ts: parseScannedAt(value.scanned_at, now),
  };
}

export function normalizeScannedItems(value: unknown): ScannedItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => toScannedItem(item))
    .filter((item): item is ScannedItem => item !== null)
    .sort((left, right) => {
      const byTime = right.ts.getTime() - left.ts.getTime();
      return byTime === 0 ? right.id - left.id : byTime;
    });
}

export function countScannedItems(items: ScannedItem[]): number {
  return items.reduce((total, item) => total + item.quantity, 0);
}

export function upsertScannedItem(items: ScannedItem[], nextItem: ScannedItem): ScannedItem[] {
  return [nextItem, ...items.filter(item => item.id !== nextItem.id)];
}

export interface CameraDetectionState {
  activeCode: string | null;
  missedDetectionCount: number;
}

const CAMERA_REARM_MISSED_DETECTIONS = 3;

export function evaluateDetectedCameraCode(
  state: CameraDetectionState,
  code: string,
  isProcessing: boolean
): {
  nextState: CameraDetectionState;
  acceptedCode: string | null;
} {
  const cleanCode = code.trim();

  if (!cleanCode || isProcessing || state.activeCode === cleanCode) {
    return { nextState: state, acceptedCode: null };
  }

  return {
    nextState: { activeCode: cleanCode, missedDetectionCount: 0 },
    acceptedCode: cleanCode,
  };
}

export function evaluateUndetectedCameraFrame(
  state: CameraDetectionState,
  isProcessing: boolean
): {
  nextState: CameraDetectionState;
  rearmed: boolean;
} {
  if (isProcessing || !state.activeCode) {
    return { nextState: state, rearmed: false };
  }

  const missedDetectionCount = state.missedDetectionCount + 1;
  if (missedDetectionCount >= CAMERA_REARM_MISSED_DETECTIONS) {
    return {
      nextState: { activeCode: null, missedDetectionCount: 0 },
      rearmed: true,
    };
  }

  return {
    nextState: { activeCode: state.activeCode, missedDetectionCount },
    rearmed: false,
  };
}

export function shouldStartCameraScanner(
  inputMode: MobileScanInputMode,
  hasSessionCredentials: boolean,
  sessionStatus: MobileSessionStatus | null,
  cameraError: string | null,
  hasReader: boolean,
  hasControls: boolean
): boolean {
  return (
    inputMode === 'camera' &&
    hasSessionCredentials &&
    sessionStatus === 'active' &&
    !cameraError &&
    !hasReader &&
    !hasControls
  );
}

export function buildMobileSessionSnapshot(payload: unknown): {
  items: ScannedItem[];
  scanCount: number;
  sessionStatus: MobileSessionStatus | null;
} {
  if (!isRecord(payload)) {
    return { items: [], scanCount: 0, sessionStatus: null };
  }

  const items = normalizeScannedItems(payload.items);
  const sessionStatus = isMobileSessionStatus(payload.status) ? payload.status : null;

  return {
    items,
    scanCount: countScannedItems(items),
    sessionStatus,
  };
}

export function classifySessionSyncResponse(
  ok: boolean,
  status: number,
  payload: unknown,
  currentFatalError: string | null,
  wasConnected: boolean
):
  | { kind: 'success'; payload: Record<string, unknown> }
  | { kind: 'fatal_error'; message: string; shouldToast: boolean }
  | { kind: 'transient_error'; message: string; shouldToast: boolean }
  | { kind: 'invalid_payload'; message: string; shouldToast: boolean } {
  if (!ok) {
    if (status === 401 || status === 403 || status === 404) {
      const message = readScanErrorMessage(payload, 'Could not refresh scan session.');
      return {
        kind: 'fatal_error',
        message,
        shouldToast: currentFatalError !== message,
      };
    }

    return {
      kind: 'transient_error',
      message: 'Could not refresh scan session.',
      shouldToast: wasConnected,
    };
  }

  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    return {
      kind: 'invalid_payload',
      message: 'Invalid session response.',
      shouldToast: currentFatalError !== 'Invalid session response.',
    };
  }

  return { kind: 'success', payload };
}

export function resolveSubmittedScanItem(
  payload: unknown,
  upc: string,
  itemName?: string,
  now = Date.now()
): ScannedItem {
  const serverItem = isRecord(payload) ? toScannedItem(payload.item, now) : null;

  if (serverItem) {
    return serverItem;
  }

  const cleanUpc = upc.trim();
  const cleanName = itemName?.trim();

  return {
    id: now,
    name: cleanName || cleanUpc,
    upc: cleanUpc,
    unit: '',
    ts: new Date(now),
    quantity: 1,
  };
}

export function getSubmitScanGuard(
  sessionId: string | undefined,
  sessionStatus: MobileSessionStatus | null
): string | null {
  if (!sessionId) {
    return 'Missing session ID';
  }

  if (sessionStatus !== 'active') {
    return 'Scanning is paused for this session.';
  }

  return null;
}

export function buildSubmitScanRequest(
  sessionId: string,
  otp: string | null,
  upc: string,
  itemName?: string
): {
  url: string;
  init: FetchInit;
} {
  return {
    url: `/api/session/${sessionId}/scan`,
    init: {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId() },
      body: JSON.stringify({ upc, otp, item_name: itemName || undefined }),
    },
  };
}

export function evaluateCameraIdleProgress(
  idleDeadline: number,
  now = Date.now()
): {
  hasDeadline: boolean;
  progress: number;
  shouldIdle: boolean;
} {
  if (!idleDeadline) {
    return { hasDeadline: false, progress: 1, shouldIdle: false };
  }

  const remaining = idleDeadline - now;
  const progress = Math.max(0, Math.min(1, remaining / MOBILE_SCAN_IDLE_TIMEOUT_MS));

  return {
    hasDeadline: true,
    progress,
    shouldIdle: progress === 0,
  };
}

export function getCameraRuntimeError(
  isSecureContext: boolean,
  hasGetUserMedia: boolean
): string | null {
  return isSecureContext && hasGetUserMedia
    ? null
    : 'Camera requires HTTPS. Open the tunnel URL, not the LAN IP.';
}

export function getCameraLifecycleAction(
  hasSessionCredentials: boolean,
  inputMode: MobileScanInputMode,
  sessionStatus: MobileSessionStatus | null,
  cameraError: string | null
): 'idle' | 'start' | 'stop' {
  if (!hasSessionCredentials) {
    return 'idle';
  }

  return inputMode === 'camera' && sessionStatus === 'active' && !cameraError ? 'start' : 'stop';
}

export function shouldStopIdleCamera(cameraIdle: boolean, inputMode: MobileScanInputMode): boolean {
  return cameraIdle && inputMode === 'camera';
}

export function canSubmitManualScan(
  manualInput: string,
  isProcessing: boolean,
  sessionStatus: MobileSessionStatus | null
): boolean {
  return Boolean(manualInput.trim()) && !isProcessing && sessionStatus === 'active';
}

export function useMobileScan({ sessionId, otp }: UseMobileScanOptions) {
  const codeReaderRef = useRef<ScannerReader | null>(null);
  const activeControlsRef = useRef<ScannerControls | null>(null);
  const startScannerGenRef = useRef(0);
  const detectionStateRef = useRef<CameraDetectionState>({
    activeCode: null,
    missedDetectionCount: 0,
  });
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProcessingRef = useRef(false);
  const idleDeadlineRef = useRef(0);
  const idleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onScanRef = useRef<(code: string) => Promise<void>>(async () => {});

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
  const [sessionStatus, setSessionStatus] = useState<MobileSessionStatus | null>(null);

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

  const submitScan = useCallback(
    async (upc: string, itemName?: string) => {
      const guardMessage = getSubmitScanGuard(sessionId, sessionStatus);
      if (guardMessage) {
        showToast('error', guardMessage);
        isProcessingRef.current = false;
        setIsProcessing(false);
        return;
      }

      try {
        const activeSessionId = sessionId;
        if (!activeSessionId) {
          return;
        }

        const request = buildSubmitScanRequest(activeSessionId, otp, upc, itemName);
        const res = await fetch(request.url, request.init);

        const raw = await res.text();
        const payload = parseScanResponsePayload(raw);

        if (!res.ok) {
          const message = readScanErrorMessage(payload, 'Could not add barcode');
          showToast('error', message);
          return;
        }

        setIsConnected(true);
        setReconnectAttempts(0);

        const newItem = resolveSubmittedScanItem(payload, upc, itemName);
        setScannedItems(prev => {
          const nextItems = upsertScannedItem(prev, newItem);
          setScanCount(countScannedItems(nextItems));
          return nextItems;
        });

        if (navigator.vibrate) {
          navigator.vibrate([100, 50, 100]);
        }

        showToast('success', newItem.name);
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
    [otp, sessionId, sessionStatus, showToast]
  );

  useEffect(() => {
    if (!sessionId || !otp) {
      return;
    }

    fetch(
      `/api/session/${sessionId}/items?otp=${otp}&device_id=${encodeURIComponent(getDeviceId())}`
    )
      .then(async res => {
        const raw = await res.text();
        const payload = parseScanResponsePayload(raw);
        const classification = classifySessionSyncResponse(
          res.ok,
          res.status,
          payload,
          cameraError,
          isConnected
        );

        if (classification.kind !== 'success') {
          if (classification.kind === 'fatal_error' || classification.kind === 'invalid_payload') {
            setCameraError(classification.message);
          } else {
            setIsConnected(false);
            setReconnectAttempts(prev => prev + 1);
          }

          if (classification.shouldToast) {
            showToast('error', classification.message);
          }
          return;
        }

        setIsConnected(true);
        setReconnectAttempts(0);

        const snapshot = buildMobileSessionSnapshot(classification.payload);
        setScannedItems(snapshot.items);
        setScanCount(snapshot.scanCount);
        setSessionStatus(snapshot.sessionStatus);
      })
      .catch(() => {
        setIsConnected(false);
        setReconnectAttempts(prev => prev + 1);
      });
  }, [cameraError, isConnected, otp, sessionId, showToast]);

  useEffect(() => {
    onScanRef.current = async (code: string) => {
      const result = evaluateDetectedCameraCode(
        detectionStateRef.current,
        code,
        isProcessingRef.current
      );
      detectionStateRef.current = result.nextState;

      if (!result.acceptedCode) {
        return;
      }

      if (import.meta.env.DEV) {
        console.warn('SCANNED CODE:', result.acceptedCode);
      }

      isProcessingRef.current = true;
      setIsProcessing(true);
      resetIdleTimer();

      await submitScan(result.acceptedCode);
    };
  }, [resetIdleTimer, submitScan]);

  useEffect(() => {
    if (inputMode !== 'camera' || cameraIdle) {
      return;
    }

    idleIntervalRef.current = globalThis.setInterval(() => {
      const idleEvaluation = evaluateCameraIdleProgress(idleDeadlineRef.current);
      if (!idleEvaluation.hasDeadline) {
        return;
      }

      setIdleProgress(idleEvaluation.progress);

      if (idleEvaluation.shouldIdle && !cameraIdle) {
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
    startScannerGenRef.current++; // invalidate any in-flight startScanner

    const controls = activeControlsRef.current;
    const reader = codeReaderRef.current;

    activeControlsRef.current = null;
    codeReaderRef.current = null;

    await stopScannerResources(MOBILE_SCAN_ELEMENT_ID, controls, reader);
    setCameraError(null);
  }, []);

  const startScanner = useCallback(async () => {
    if (
      !shouldStartCameraScanner(
        inputMode,
        Boolean(sessionId && otp),
        sessionStatus,
        cameraError,
        Boolean(codeReaderRef.current),
        Boolean(activeControlsRef.current)
      )
    ) {
      return;
    }

    setCameraError(null);

    const runtimeError = getCameraRuntimeError(
      globalThis.isSecureContext,
      Boolean(navigator.mediaDevices?.getUserMedia)
    );
    if (runtimeError) {
      setCameraError(runtimeError);
      return;
    }

    const gen = ++startScannerGenRef.current;

    try {
      const nativeControls = await startNativeScanner({
        scannerElementId: MOBILE_SCAN_ELEMENT_ID,
        isProcessing: () => isProcessingRef.current,
        onDetected: code => onScanRef.current(code),
        onUndetected: () => {
          const result = evaluateUndetectedCameraFrame(
            detectionStateRef.current,
            isProcessingRef.current
          );
          detectionStateRef.current = result.nextState;
        },
      });

      if (gen !== startScannerGenRef.current) {
        // inputMode changed or stopScanner was called while we awaited — release resources
        if (nativeControls)
          await stopScannerResources(MOBILE_SCAN_ELEMENT_ID, nativeControls, null);
        return;
      }

      if (nativeControls) {
        activeControlsRef.current = nativeControls;
        resetIdleTimer();
        return;
      }

      const { controls, reader } = await startFallbackScanner({
        scannerElementId: MOBILE_SCAN_ELEMENT_ID,
        isProcessing: () => isProcessingRef.current,
        onDetected: code => onScanRef.current(code),
        onUndetected: () => {
          const result = evaluateUndetectedCameraFrame(
            detectionStateRef.current,
            isProcessingRef.current
          );
          detectionStateRef.current = result.nextState;
        },
      });

      if (gen !== startScannerGenRef.current) {
        await stopScannerResources(MOBILE_SCAN_ELEMENT_ID, controls, reader);
        return;
      }

      activeControlsRef.current = controls;
      codeReaderRef.current = reader;
      resetIdleTimer();
    } catch (error) {
      if (gen !== startScannerGenRef.current) return;
      console.error('Camera start error:', error);
      activeControlsRef.current = null;
      codeReaderRef.current = null;
      setCameraError(buildCameraErrorMessage(error));
    }
  }, [cameraError, inputMode, otp, resetIdleTimer, sessionId, sessionStatus]);

  useEffect(() => {
    if (inputMode === 'camera') {
      void startScanner();
    } else {
      void stopScanner();
    }

    return () => {
      void stopScanner();
    };
  }, [inputMode, startScanner, stopScanner]);

  useEffect(() => {
    if (shouldStopIdleCamera(cameraIdle, inputMode)) {
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
    await new Promise(resolve => setTimeout(resolve, 300));
    setCameraError(null);
    await startScanner();
  }, [startScanner, stopScanner]);

  const retryConnection = useCallback(() => {
    setReconnectAttempts(0);
    setIsConnected(true);
  }, []);

  return {
    scannerElementId: MOBILE_SCAN_ELEMENT_ID,
    inputMode,
    isProcessing,
    manualInput,
    manualItemName,
    scanCount,
    scannedItems,
    cameraError,
    cameraIdle,
    idleProgress,
    toast,
    isConnected,
    reconnectAttempts,
    sessionStatus,
    setInputMode,
    setManualInput,
    setManualItemName,
    handleManualSubmit,
    handleResumeCamera,
    handleResetCamera,
    retryConnection,
  };
}
