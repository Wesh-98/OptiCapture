import { AlertTriangle, Camera, RefreshCw } from 'lucide-react';
import type { MobileScanInputMode } from './types';

interface MobileScanCameraPanelProps {
  scannerElementId: string;
  inputMode: MobileScanInputMode;
  isProcessing: boolean;
  cameraIdle: boolean;
  cameraError: string | null;
  onResumeCamera: () => void | Promise<void>;
  onResetCamera: () => void | Promise<void>;
}

export function MobileScanCameraPanel({
  scannerElementId,
  inputMode,
  isProcessing,
  cameraIdle,
  cameraError,
  onResumeCamera,
  onResetCamera,
}: MobileScanCameraPanelProps) {
  return (
    <div
      className="shrink-0 mx-4 mt-2 rounded-2xl overflow-hidden relative bg-black"
      style={{ height: '42vh' }}
    >
      <video id={scannerElementId} className="w-full h-full object-cover" autoPlay muted playsInline />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="w-3/4 h-28 relative">
          <div className="absolute -top-1 -left-1 w-6 h-6 border-t-2 border-l-2 border-emerald-400" />
          <div className="absolute -top-1 -right-1 w-6 h-6 border-t-2 border-r-2 border-emerald-400" />
          <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-2 border-l-2 border-emerald-400" />
          <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-2 border-r-2 border-emerald-400" />
          <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 h-0.5 bg-red-400/80 shadow-[0_0_8px_rgba(248,113,113,0.8)] animate-pulse" />
        </div>
      </div>

      {isProcessing && <div className="absolute inset-0 bg-emerald-400/10 pointer-events-none" />}

      {inputMode === 'camera' && cameraIdle && (
        <div
          role="button"
          tabIndex={0}
          className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-4 cursor-pointer"
          onClick={() => {
            void onResumeCamera();
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              void onResumeCamera();
            }
          }}
        >
          <Camera size={40} className="text-white" />
          <p className="text-white text-lg font-medium">Tap to resume</p>
        </div>
      )}

      {inputMode === 'camera' && cameraError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-4 px-6">
          <AlertTriangle size={40} className="text-red-400" />
          <p className="text-white text-sm text-center">{cameraError}</p>
          <button
            onClick={() => {
              void onResetCamera();
            }}
            className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold text-sm"
          >
            Try Again
          </button>
        </div>
      )}

      {inputMode === 'camera' && !cameraError && !cameraIdle && (
        <button
          onClick={() => {
            void onResetCamera();
          }}
          className="absolute top-2 right-2 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white transition-colors"
          title="Reset camera"
        >
          <RefreshCw size={14} />
        </button>
      )}
    </div>
  );
}
