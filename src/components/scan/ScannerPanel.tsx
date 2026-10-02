import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, Wifi, ShieldCheck, ScanBarcode, CheckCircle2, Loader2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ServerInfo, UiStatus } from './types';

interface Props {
  scanInputMode: 'mobile' | 'hardware';
  setScanInputMode: (m: 'mobile' | 'hardware') => void;
  serverInfo: ServerInfo | null;
  ipLoading: boolean;
  otp: string | null;
  mobileUrl: string;
  uiStatus: UiStatus;
  lastHardwareScan: string | null;
  onResetSession: () => void;
}

export function ScannerPanel({
  scanInputMode,
  setScanInputMode,
  serverInfo,
  ipLoading,
  otp,
  mobileUrl,
  uiStatus,
  lastHardwareScan,
  onResetSession,
}: Readonly<Props>) {
  return (
    <div className="lg:col-span-1">
      <div className="bg-white text-slate-900 border border-slate-200 rounded-2xl shadow-sm overflow-hidden relative">
        {/* Mode tabs */}
        <div className="relative z-10 flex border-b border-slate-200">
          <button
            onClick={() => setScanInputMode('mobile')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-semibold transition-colors',
              scanInputMode === 'mobile'
                ? 'bg-brand-50 text-brand-600 border-b-2 border-brand-500'
                : 'text-slate-500 hover:text-navy-900 hover:bg-slate-50'
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
                ? 'bg-brand-50 text-brand-600 border-b-2 border-brand-500'
                : 'text-slate-500 hover:text-navy-900 hover:bg-slate-50'
            )}
          >
            <ScanBarcode size={16} />
            Attach Scanner
          </button>
        </div>

        {/* Panel content */}
        <div className="relative z-10 p-6 text-center bg-white text-brand-600">
          {scanInputMode === 'mobile' ? (
            <>
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-600 mb-4 shadow-sm">
                <Smartphone className="text-white" size={24} />
              </div>
              <h3 className="text-lg font-bold mb-2">Connect Mobile</h3>
              <p className="text-brand-600 text-sm mb-6">
                Scan this QR code with your phone to start scanning items remotely.
              </p>
              <div className="bg-white p-4 rounded-xl inline-block border-2 border-brand-500 shadow-sm mb-4">
                {ipLoading ? (
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

              <div className="text-left bg-slate-50 border border-brand-500 p-4 rounded-lg mb-4 space-y-2">
                <p className="text-xs text-slate-500">Connection Details:</p>
                <div className="flex items-center gap-2 text-xs font-mono text-emerald-700 break-all">
                  <Wifi size={14} />
                  <span>
                    {serverInfo?.tunnelUrl
                      ? `Tunnel: ${serverInfo.tunnelUrl}`
                      : `Origin: ${globalThis.location.origin}`}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono text-emerald-700">
                  <ShieldCheck size={14} />
                  <span>
                    Protocol: {globalThis.location.protocol.replaceAll(':', '').toUpperCase()}
                  </span>
                </div>
                {otp && (
                  <p className="text-xs font-mono text-emerald-700">
                    OTP: <span className="font-bold text-lg tracking-widest">{otp}</span>
                  </p>
                )}
                {mobileUrl && (
                  <p className="text-xs font-mono text-emerald-700 break-all">{mobileUrl}</p>
                )}
              </div>

              <div className="flex items-center justify-center gap-2 text-xs text-slate-600 font-mono bg-slate-50 border border-brand-500 py-2 rounded-lg">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                {serverInfo?.ip && serverInfo.ip !== 'localhost' ? 'Network Ready' : 'Local Mode'}
              </div>
            </>
          ) : (
            <>
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-600 mb-4 shadow-sm">
                <ScanBarcode className="text-white" size={24} />
              </div>
              <h3 className="text-lg font-bold mb-2">Hardware Scanner</h3>
              <p className="text-brand-600 text-sm mb-6">
                Plug in a USB barcode scanner or pair a Bluetooth scanner, then pull the trigger on
                any product.
              </p>

              {/* Ready indicator */}
              <div
                className={cn(
                  'flex flex-col items-center justify-center gap-3 py-8 rounded-xl mb-4',
                  uiStatus === 'ready'
                    ? 'bg-emerald-50 border border-brand-500'
                    : 'bg-slate-50 border border-brand-500'
                )}
              >
                {uiStatus === 'ready' ? (
                  <>
                    <div className="relative flex items-center justify-center">
                      <div className="absolute w-14 h-14 rounded-full bg-emerald-500/20 animate-ping" />
                      <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <div className="w-4 h-4 rounded-full bg-emerald-500" />
                      </div>
                    </div>
                    <p className="text-emerald-700 font-semibold text-sm">Scanner Ready</p>
                    <p className="text-slate-500 text-xs">Pull the trigger to scan</p>
                  </>
                ) : uiStatus === 'error' ? (
                  <>
                    <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                      <X size={20} className="text-red-500" />
                    </div>
                    <p className="text-red-600 font-semibold text-sm">Session failed to start</p>
                    <button
                      onClick={onResetSession}
                      className="mt-1 px-3 py-1.5 bg-navy-900 hover:bg-navy-800 text-white text-xs rounded-lg transition-colors"
                    >
                      Retry
                    </button>
                  </>
                ) : (
                  <>
                    <Loader2 size={28} className="text-slate-400 animate-spin" />
                    <p className="text-slate-500 text-sm">Waiting for session...</p>
                  </>
                )}
              </div>

              {/* Last scanned */}
              <div className="bg-slate-50 border border-brand-500 p-4 rounded-lg text-left space-y-1">
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                  Last Scanned
                </p>
                {lastHardwareScan ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                    <p className="font-mono text-emerald-700 text-sm tracking-widest truncate">
                      {lastHardwareScan}
                    </p>
                  </div>
                ) : (
                  <p className="text-slate-400 text-xs italic">No barcode scanned yet</p>
                )}
              </div>

              <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-600 font-mono bg-slate-50 border border-brand-500 py-2 rounded-lg">
                <div
                  className={cn(
                    'w-2 h-2 rounded-full',
                    uiStatus === 'ready' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'
                  )}
                />
                {uiStatus === 'ready' ? 'Listening for scans' : 'Session not ready'}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
