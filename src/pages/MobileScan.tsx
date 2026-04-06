import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { CheckCircle, AlertTriangle, Camera, Keyboard, RefreshCw } from 'lucide-react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

const IDLE_TIMEOUT_MS = 60_000;

function getDeviceId(): string {
  const STORAGE_KEY = 'scan_device_id';
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

interface ScannedItem {
  id: number;
  name: string;
  upc: string;
  ts: Date;
}

export default function MobileScan() {
  const prefersReducedMotion = useReducedMotion();

  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const otp = searchParams.get('otp');

  const scannerElementId = 'mobile-reader';
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const activeControlsRef = useRef<any>(null);
  const lastScanRef = useRef<{ code: string; time: number } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProcessingRef = useRef<boolean>(false);
  const idleDeadlineRef = useRef<number>(0);
  const idleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onScanRef = useRef<(code: string) => Promise<void>>(async () => {});

  const [inputMode, setInputMode] = useState<'camera' | 'manual'>('camera');
  const [isProcessing, setIsProcessing] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [manualItemName, setManualItemName] = useState('');
  const [scanCount, setScanCount] = useState(0);
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraIdle, setCameraIdle] = useState(false);
  const [idleProgress, setIdleProgress] = useState(1);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isConnected, setIsConnected] = useState(true);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [sessionDraft, setSessionDraft] = useState(false);

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    if (toastTimerRef.current) globalThis.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = globalThis.setTimeout(() => setToast(null), 3000);
  }, []);

  const resetIdleTimer = useCallback(() => {
    idleDeadlineRef.current = Date.now() + IDLE_TIMEOUT_MS;
    setCameraIdle(false);
    setIdleProgress(1);
  }, []);

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

        const raw = await res.text();
        let payload: any = null;

        try {
          payload = raw ? JSON.parse(raw) : null;
        } catch {
          payload = raw;
        }

        if (!res.ok) {
          const message =
            typeof payload === 'object' && payload?.error
              ? payload.error
              : 'Could not add barcode';
          showToast('error', message);
          return;
        }

        setIsConnected(true);
        setReconnectAttempts(0);

        const productName = payload?.item?.product_name || upc;
        const newItem: ScannedItem = {
          id: Date.now(),
          name: productName,
          upc,
          ts: new Date()
        };

        setScannedItems(prev => [newItem, ...prev]);
        setScanCount(prev => prev + 1);

        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        showToast('success', productName);
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
    [sessionId, otp, showToast]
  );

  // Reconnect: fetch existing items + draft status on mount (handles screen lock)
  useEffect(() => {
    if (!sessionId || !otp) return;
    fetch(`/api/session/${sessionId}/items?otp=${otp}&device_id=${encodeURIComponent(getDeviceId())}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data) return;
        const { items: existing, status } = data;
        if (Array.isArray(existing) && existing.length > 0) {
          const loaded: ScannedItem[] = existing.map((item: any) => ({
            id: item.id,
            name: item.product_name || item.upc,
            upc: item.upc,
            ts: new Date(item.scanned_at),
          }));
          setScannedItems(loaded);
          setScanCount(loaded.length);
        }
        if (status === 'draft') setSessionDraft(true);
      })
      .catch(() => { /* ignore */ });
  }, [sessionId, otp]);

  // Update scan callback ref
  useEffect(() => {
    onScanRef.current = async (code: string) => {
      const cleanCode = code.trim();
      if (!cleanCode || isProcessingRef.current) return;

      const now = Date.now();
      if (lastScanRef.current?.code === cleanCode && now - lastScanRef.current.time < 2000) {
        return;
      }

      if (import.meta.env.DEV) console.warn('SCANNED CODE:', cleanCode);

      lastScanRef.current = { code: cleanCode, time: now };
      isProcessingRef.current = true;
      setIsProcessing(true);
      resetIdleTimer();

      await submitScan(cleanCode);
    };
  }, [submitScan, resetIdleTimer]);

  // Idle timer ticker
  useEffect(() => {
    if (inputMode !== 'camera' || cameraIdle) return;

    idleIntervalRef.current = globalThis.setInterval(() => {
      if (!idleDeadlineRef.current) return;

      const remaining = idleDeadlineRef.current - Date.now();
      const progress = Math.max(0, Math.min(1, remaining / IDLE_TIMEOUT_MS));

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
  }, [inputMode, cameraIdle]);

  const stopScanner = useCallback(async () => {
    try {
      if (activeControlsRef.current) {
        await activeControlsRef.current.stop();
        activeControlsRef.current = null;
      }
    } catch (error) {
      console.warn('Scanner controls stop warning:', error);
    }

    try {
      if (codeReaderRef.current) {
        (codeReaderRef.current as any).reset();
        codeReaderRef.current = null;
      }
    } catch (error) {
      console.warn('Scanner reset warning:', error);
    }

    const videoEl = document.getElementById(scannerElementId) as HTMLVideoElement | null;
    if (videoEl) {
      videoEl.srcObject = null;
    }

    setCameraError(null);
  }, []);

  const startScanner = useCallback(async () => {
    if (inputMode !== 'camera' || codeReaderRef.current) return;

    setCameraError(null);

    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera requires HTTPS. Open the tunnel URL, not the LAN IP.');
      return;
    }

    try {
      const hints = new Map();
      hints.set(DecodeHintType.TRY_HARDER, true);
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
      ]);

      const codeReader = new BrowserMultiFormatReader(hints);
      codeReaderRef.current = codeReader;

      const controls = await codeReader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
          },
        },
        scannerElementId,
        async (result, _error) => {
          if (result) {
            const code = result.getText();
            await onScanRef.current(code);
          }
        }
      );

      activeControlsRef.current = controls;
      resetIdleTimer();
    } catch (error: any) {
      console.error('Camera start error:', error);

      // Clean up so retry is possible
      codeReaderRef.current = null;
      activeControlsRef.current = null;

      const errName = error?.name || '';
      let message = 'Could not access camera.';
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        message = 'Camera permission denied. Tap the address bar lock icon and allow camera access.';
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        message = 'No camera found on this device.';
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
        message = 'Camera is in use by another app. Close it and try again.';
      } else if (error?.message) {
        message = `Camera error: ${error.message}`;
      }

      setCameraError(message);
    }
  }, [inputMode, resetIdleTimer]);

  useEffect(() => {
    if (inputMode === 'camera') {
      startScanner();
    } else {
      stopScanner();
    }

    return () => {
      stopScanner();
    };
  }, [inputMode, startScanner, stopScanner]);

  // Stop camera when idle timer expires
  useEffect(() => {
    if (cameraIdle && inputMode === 'camera') {
      stopScanner();
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
      stopScanner();
    };
  }, [stopScanner]);

  const handleManualSubmit = async (e) => {
    e.preventDefault();

    const upc = manualInput.trim();
    if (!upc || isProcessingRef.current) return;

    isProcessingRef.current = true;
    setIsProcessing(true);

    await submitScan(upc, manualItemName.trim() || undefined);
    setManualInput('');
    setManualItemName('');
  };

  const handleResumeCamera = useCallback(async () => {
    setCameraIdle(false);
    resetIdleTimer();
    await startScanner();
  }, [resetIdleTimer, startScanner]);

  const handleResetCamera = useCallback(async () => {
    await stopScanner();
    await new Promise(r => setTimeout(r, 300));
    setCameraError(null);
    await startScanner();
  }, [stopScanner, startScanner]);

  // Draft mode: no camera, no scanning
  if (sessionDraft) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#0d1117] text-white px-6 gap-6">
        <div className="w-14 h-14 rounded-full bg-amber-500/20 flex items-center justify-center">
          <span className="text-amber-400 text-2xl">🔒</span>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-white mb-1">Session in review mode</p>
          <p className="text-sm text-slate-400">Scanning paused by the store owner.</p>
        </div>
        <div className="px-6 py-3 bg-white/5 rounded-2xl text-center">
          <p className="text-3xl font-black text-white">{scanCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">items scanned</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#0d1117] text-white">
      {/* Header */}
      <div className="shrink-0 flex items-center px-4 py-3">
        {/* Left: connection dot + session ID */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400 animate-pulse'}`} />
          <span className="text-xs font-mono text-slate-400">{sessionId?.slice(0, 8) || 'unknown'}</span>
        </div>

        {/* Center: big scan count */}
        <div className="flex-1 flex flex-col items-center">
          <span className="text-4xl font-black text-white">{scanCount}</span>
          <span className="text-xs text-slate-600">items scanned</span>
        </div>

        {/* Right: spacer */}
        <div className="w-16"></div>
      </div>

      {/* Camera box */}
      <div className="shrink-0 mx-4 mt-2 rounded-2xl overflow-hidden relative bg-black" style={{ height: '42vh' }}>
        <video id="mobile-reader" className="w-full h-full object-cover" autoPlay muted playsInline />

        {/* Scan guide overlay */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="w-3/4 h-28 relative">
            {/* Corner brackets */}
            <div className="absolute -top-1 -left-1 w-6 h-6 border-t-2 border-l-2 border-emerald-400" />
            <div className="absolute -top-1 -right-1 w-6 h-6 border-t-2 border-r-2 border-emerald-400" />
            <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-2 border-l-2 border-emerald-400" />
            <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-2 border-r-2 border-emerald-400" />

            {/* Red scan line */}
            <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 h-0.5 bg-red-400/80 shadow-[0_0_8px_rgba(248,113,113,0.8)] animate-pulse" />
          </div>
        </div>

        {/* Processing flash */}
        {isProcessing && (
          <div className="absolute inset-0 bg-emerald-400/10 pointer-events-none" />
        )}

        {/* Idle overlay */}
        {inputMode === 'camera' && cameraIdle && (
          <div
            role="button"
            tabIndex={0}
            className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-4 cursor-pointer"
            onClick={handleResumeCamera}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleResumeCamera(); }}
          >
            <Camera size={40} className="text-white" />
            <p className="text-white text-lg font-medium">Tap to resume</p>
          </div>
        )}

        {/* Error overlay */}
        {inputMode === 'camera' && cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-4 px-6">
            <AlertTriangle size={40} className="text-red-400" />
            <p className="text-white text-sm text-center">{cameraError}</p>
            <button
              onClick={handleResetCamera}
              className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold text-sm"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Reset camera button — always visible in corner when camera is active */}
        {inputMode === 'camera' && !cameraError && !cameraIdle && (
          <button
            onClick={handleResetCamera}
            className="absolute top-2 right-2 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white transition-colors"
            title="Reset camera"
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>

      {/* Idle progress bar */}
      {inputMode === 'camera' && !cameraIdle && (
        <div className="shrink-0 mx-4 mt-1.5 h-0.5 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-400 transition-all duration-300 ease-linear"
            style={{ width: `${idleProgress * 100}%` }}
          />
        </div>
      )}

      {/* Mode toggle */}
      <div className="shrink-0 mx-4 mt-3 flex bg-white/5 rounded-2xl p-1">
        <button
          onClick={() => setInputMode('camera')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-colors ${
            inputMode === 'camera' ? 'bg-emerald-600 text-white' : 'text-slate-500'
          }`}
        >
          <Camera size={16} />
          Camera
        </button>
        <button
          onClick={() => setInputMode('manual')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-colors ${
            inputMode === 'manual' ? 'bg-emerald-600 text-white' : 'text-slate-500'
          }`}
        >
          <Keyboard size={16} />
          Manual
        </button>
      </div>

      {/* Manual form */}
      {inputMode === 'manual' && (
        <div className="shrink-0 mx-4 mt-3 space-y-3">
          <form onSubmit={handleManualSubmit} className="space-y-3">
            <input
              type="text"
              value={manualItemName}
              onChange={e => setManualItemName(e.target.value)}
              placeholder="Item name (optional)"
              className="w-full px-4 py-3 bg-white/[0.08] border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              disabled={isProcessing}
            />
            <input
              type="text"
              inputMode="numeric"
              value={manualInput}
              onChange={e => setManualInput(e.target.value)}
              placeholder="UPC / Barcode *"
              className="w-full px-4 py-3 bg-white/[0.08] border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
              disabled={isProcessing}
              autoFocus
            />
            <button
              type="submit"
              disabled={!manualInput.trim() || isProcessing}
              className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold disabled:opacity-50 transition-colors"
            >
              {isProcessing ? 'Adding…' : 'Add Item'}
            </button>
          </form>
        </div>
      )}

      {/* Scanned items list */}
      <div className="flex-1 overflow-y-auto mx-4 mt-3 pb-2 min-h-0">
        {scannedItems.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-slate-700 text-sm">No items scanned yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {scannedItems.map((item) => (
                <motion.div
                  key={item.id}
                  initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
                  animate={prefersReducedMotion ? {} : { opacity: 1, height: 'auto' }}
                  exit={prefersReducedMotion ? {} : { opacity: 0, height: 0 }}
                  className="flex items-center gap-3 px-3 py-2.5 bg-white/5 rounded-xl"
                >
                  <CheckCircle size={16} className="text-emerald-400 shrink-0" />
                  <span className="flex-1 text-white text-sm truncate">{item.name}</span>
                  <span className="text-slate-600 text-xs shrink-0">{formatTime(item.ts)}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Connection lost banner */}
      {!isConnected && (
        <div className="shrink-0 mx-4 mb-2 flex items-center gap-2 px-3 py-2 bg-amber-500/20 border border-amber-500/30 rounded-xl text-sm text-amber-300">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
          <span className="flex-1">
            {reconnectAttempts < 3 ? 'Connection lost — reconnecting...' : 'Unable to reach server. Check your network.'}
          </span>
          {reconnectAttempts >= 3 && (
            <button
              onClick={() => { setReconnectAttempts(0); setIsConnected(true); }}
              className="text-xs font-semibold underline underline-offset-2 text-amber-300"
            >
              Retry now
            </button>
          )}
        </div>
      )}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={prefersReducedMotion ? false : { y: 80, opacity: 0 }}
            animate={prefersReducedMotion ? {} : { y: 0, opacity: 1 }}
            exit={prefersReducedMotion ? {} : { y: 80, opacity: 0 }}
            transition={prefersReducedMotion ? {} : { type: 'spring', stiffness: 400, damping: 30 }}
            className={`fixed bottom-6 left-4 right-4 z-50 px-4 py-3 rounded-2xl flex items-center gap-3 shadow-2xl ${
              toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
            }`}
          >
            {toast.type === 'success'
              ? <CheckCircle size={20} className="text-white shrink-0" />
              : <AlertTriangle size={20} className="text-white shrink-0" />}
            <span className="text-white text-sm font-medium">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}