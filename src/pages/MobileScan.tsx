import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { CheckCircle, Barcode, AlertTriangle, Camera, Keyboard } from 'lucide-react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

type ScanStatus = 'idle' | 'scanning' | 'success' | 'error';

export default function MobileScan() {
  const prefersReducedMotion = useReducedMotion();

  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const otp = searchParams.get('otp');

  const scannerElementId = 'mobile-reader';
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const activeControlsRef = useRef<any>(null);
  const unlockTimerRef = useRef<number | null>(null);
  const lastScanRef = useRef<{ code: string; time: number } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [inputMode, setInputMode] = useState<'camera' | 'manual'>('camera');
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('Ready to scan');
  const [isProcessing, setIsProcessing] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [manualItemName, setManualItemName] = useState('');
  const [scanCount, setScanCount] = useState(0);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [recentScans, setRecentScans] = useState<string[]>([]);
  const [cameraReady, setCameraReady] = useState(false);
  const [showRetry, setShowRetry] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isConnected, setIsConnected] = useState(true);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2000);
  }, []);

  const addRecentScan = useCallback((code: string) => {
    setRecentScans((prev) => [code, ...prev.filter((item) => item !== code)].slice(0, 5));
  }, []);

  const resetProcessingAfterDelay = useCallback(
    (nextStatus: ScanStatus, message: string, delay = 1200) => {
      if (unlockTimerRef.current) {
        window.clearTimeout(unlockTimerRef.current);
      }

      unlockTimerRef.current = window.setTimeout(() => {
        setStatus(nextStatus);
        setStatusMessage(message);
        setIsProcessing(false);
      }, delay);
    },
    []
  );

  const submitScan = useCallback(
    async (upc: string, itemName?: string) => {
      if (!sessionId) {
        showToast('error', 'Missing session ID');
        setIsProcessing(false);
        return;
      }

      try {
        const res = await fetch(`/api/session/${sessionId}/scan`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
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
          setIsProcessing(false);
          return;
        }

        setIsConnected(true);
        setReconnectAttempts(0);
        setLastScanned(upc);
        setScanCount((prev) => prev + 1);
        addRecentScan(upc);
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        showToast('success', payload?.item?.product_name ? `✓ ${payload.item.product_name}` : `✓ Scanned: ${upc}`);
        setIsProcessing(false);
      } catch (error) {
        console.error('Submit scan error:', error);
        setIsConnected(false);
        setReconnectAttempts(prev => prev + 1);
        showToast('error', 'Network error while submitting scan');
        setIsProcessing(false);
      }
    },
    [sessionId, otp, addRecentScan, showToast]
  );

  const handleScanSuccess = useCallback(
    async (decodedText: string) => {
      const code = decodedText.trim();
      if (!code || isProcessing) return;

      const now = Date.now();
      if (
        lastScanRef.current &&
        lastScanRef.current.code === code &&
        now - lastScanRef.current.time < 2000
      ) {
        return;
      }

      if (import.meta.env.DEV) console.log('SCANNED CODE:', code);

      lastScanRef.current = { code, time: now };
      setIsProcessing(true);

      await submitScan(code);
    },
    [isProcessing, submitScan]
  );

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

    setCameraReady(false);
  }, []);

  const startScanner = useCallback(async () => {
    if (inputMode !== 'camera' || codeReaderRef.current) return;

    setShowRetry(false);

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setStatusMessage('Camera requires HTTPS. Open the tunnel URL, not the LAN IP.');
      setCameraReady(false);
      setShowRetry(true);
      return;
    }

    try {
      setStatus('scanning');
      setStatusMessage('Starting rear camera...');

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.CODE_128,
      ]);

      const codeReader = new BrowserMultiFormatReader(hints);
      codeReaderRef.current = codeReader;

      const controls = await codeReader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        scannerElementId,
        async (result, error) => {
          if (result) {
            const code = result.getText();
            await handleScanSuccess(code);
          }
        }
      );

      activeControlsRef.current = controls;
      setCameraReady(true);
      setStatus('scanning');
      setStatusMessage('Point camera at barcode');
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

      setStatus('error');
      setStatusMessage(message);
      setCameraReady(false);
      setShowRetry(true);
    }
  }, [inputMode, handleScanSuccess]);

  useEffect(() => {
    if (inputMode === 'camera') {
      startScanner();
    } else {
      stopScanner();
      setStatus('idle');
      setStatusMessage('Manual entry mode');
    }

    return () => {
      stopScanner();
    };
  }, [inputMode, startScanner, stopScanner]);

  useEffect(() => {
    return () => {
      if (unlockTimerRef.current) {
        window.clearTimeout(unlockTimerRef.current);
      }
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      stopScanner();
    };
  }, [stopScanner]);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const upc = manualInput.trim();
    if (!upc || isProcessing) return;

    setIsProcessing(true);

    await submitScan(upc, manualItemName.trim() || undefined);
    setManualInput('');
    setManualItemName('');
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#0a192f] border-b border-white/10">
        {/* Left: session indicator */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400 animate-pulse'}`} />
          <span className={`text-xs font-mono ${isConnected ? 'text-emerald-400' : 'text-amber-400'}`}>{sessionId?.slice(0,8)}…</span>
        </div>
        {/* Center: scan count badge */}
        <div className="flex items-center gap-1.5 bg-white/10 px-3 py-1 rounded-full">
          <Barcode size={12} className="text-slate-300" />
          <span className="text-xs font-bold text-white">{scanCount}</span>
          <span className="text-xs text-slate-400">scanned</span>
        </div>
        {/* Right: mode toggle */}
        <div className="flex bg-white/10 rounded-xl p-1 gap-1">
          <button
            onClick={() => setInputMode('camera')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
              inputMode === 'camera' ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Camera size={16} /> Camera
          </button>
          <button
            onClick={() => setInputMode('manual')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
              inputMode === 'manual' ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Keyboard size={16} /> Manual
          </button>
        </div>
      </div>

      {/* Connection status banner */}
      {!isConnected && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 mx-4 mt-3 mb-3">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
          <span className="flex-1">
            {reconnectAttempts < 3 ? 'Connection lost — reconnecting...' : 'Unable to reach server. Check your network.'}
          </span>
          {reconnectAttempts >= 3 && (
            <button
              onClick={() => { setReconnectAttempts(0); setIsConnected(true); }}
              className="text-xs font-semibold underline underline-offset-2 text-amber-700 hover:text-amber-900"
            >
              Retry now
            </button>
          )}
        </div>
      )}

      {/* Main area - flex-1 */}
      <div className="flex-1 flex flex-col">
        {inputMode === 'camera' && (
          <div className={`relative flex-1 overflow-hidden ${status === 'error' && !showRetry ? 'ring-2 ring-red-400' : ''}`}>
            <video id="mobile-reader" className="w-full h-full object-cover" autoPlay muted playsInline />
            {/* Scan guide overlay — always visible */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="w-3/4 h-28 border-2 border-white/60 rounded-xl relative">
                <div className="absolute -top-0.5 -left-0.5 w-5 h-5 border-t-2 border-l-2 border-emerald-400 rounded-tl-xl" />
                <div className="absolute -top-0.5 -right-0.5 w-5 h-5 border-t-2 border-r-2 border-emerald-400 rounded-tr-xl" />
                <div className="absolute -bottom-0.5 -left-0.5 w-5 h-5 border-b-2 border-l-2 border-emerald-400 rounded-bl-xl" />
                <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 border-b-2 border-r-2 border-emerald-400 rounded-br-xl" />
                <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 h-0.5 bg-red-400/80 shadow-[0_0_8px_rgba(248,113,113,0.8)] animate-pulse" />
              </div>
            </div>
            {/* HTTPS error with retry */}
            {status === 'error' && showRetry && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-4 px-6">
                <AlertTriangle size={40} className="text-red-400" />
                <p className="text-white text-sm text-center">{statusMessage}</p>
                <button onClick={() => { setShowRetry(false); setStatus('idle'); startScanner(); }}
                  className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold text-sm">
                  Try Again
                </button>
              </div>
            )}
          </div>
        )}

        {inputMode === 'manual' && (
          <div className="flex-1 flex flex-col justify-center gap-4 px-4 py-6">
            <div className="text-center mb-2">
              <Barcode size={36} className="text-emerald-400 mx-auto mb-2" />
              <h3 className="text-lg font-bold text-white">Manual Entry</h3>
              <p className="text-sm text-slate-400">Enter item details below</p>
            </div>
            <form onSubmit={handleManualSubmit} className="space-y-3">
              <input
                type="text"
                value={manualItemName}
                onChange={e => setManualItemName(e.target.value)}
                placeholder="Item name (optional)"
                className="w-full px-4 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
                disabled={isProcessing}
              />
              <input
                type="text"
                inputMode="numeric"
                value={manualInput}
                onChange={e => setManualInput(e.target.value)}
                placeholder="UPC / Barcode *"
                className="w-full px-4 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-base"
                disabled={isProcessing}
                autoFocus
              />
              <button type="submit" disabled={!manualInput.trim() || isProcessing}
                className="w-full py-4 bg-emerald-600 text-white rounded-xl font-bold text-base disabled:opacity-50 transition-colors active:bg-emerald-700">
                {isProcessing ? 'Adding…' : 'Add Item'}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Recent scans strip (camera mode only) */}
      {inputMode === 'camera' && recentScans.length > 0 && (
        <div className="bg-[#0a192f] border-t border-white/10 px-4 py-2 space-y-1">
          {recentScans.slice(0, 3).map((code, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="font-mono text-xs text-slate-300 truncate">{code}</span>
              <span className="text-xs text-emerald-400 font-semibold ml-2 shrink-0">✓</span>
            </div>
          ))}
        </div>
      )}

      {/* Camera tip */}
      {inputMode === 'camera' && (
        <p className="text-center text-xs text-slate-600 py-2">
          Center barcode in frame · Items sync instantly
        </p>
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