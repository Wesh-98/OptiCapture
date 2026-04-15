import { useReducedMotion } from 'motion/react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMobileScan } from '../../hooks/useMobileScan';
import { MobileScanCameraPanel } from './MobileScanCameraPanel';
import { MobileScanConnectionBanner } from './MobileScanConnectionBanner';
import { MobileScanDraftState } from './MobileScanDraftState';
import { MobileScanHeader } from './MobileScanHeader';
import { MobileScanItemsList } from './MobileScanItemsList';
import { MobileScanManualForm } from './MobileScanManualForm';
import { MobileScanModeToggle } from './MobileScanModeToggle';
import { MobileScanToast } from './MobileScanToast';

export function MobileScanScreen() {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const otp = searchParams.get('otp');

  const scan = useMobileScan({ sessionId, otp });

  if (scan.sessionDraft) {
    return <MobileScanDraftState scanCount={scan.scanCount} />;
  }

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#0d1117] text-white">
      <MobileScanHeader
        isConnected={scan.isConnected}
        scanCount={scan.scanCount}
        sessionId={sessionId}
      />

      <MobileScanCameraPanel
        scannerElementId={scan.scannerElementId}
        inputMode={scan.inputMode}
        isProcessing={scan.isProcessing}
        cameraIdle={scan.cameraIdle}
        cameraError={scan.cameraError}
        onResumeCamera={scan.handleResumeCamera}
        onResetCamera={scan.handleResetCamera}
      />

      {scan.inputMode === 'camera' && !scan.cameraIdle && (
        <div className="shrink-0 mx-4 mt-1.5 h-0.5 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-400 transition-all duration-300 ease-linear"
            style={{ width: `${scan.idleProgress * 100}%` }}
          />
        </div>
      )}

      <MobileScanModeToggle inputMode={scan.inputMode} onChange={scan.setInputMode} />

      {scan.inputMode === 'manual' && (
        <MobileScanManualForm
          manualItemName={scan.manualItemName}
          manualInput={scan.manualInput}
          isProcessing={scan.isProcessing}
          onItemNameChange={scan.setManualItemName}
          onInputChange={scan.setManualInput}
          onSubmit={scan.handleManualSubmit}
        />
      )}

      <MobileScanItemsList
        items={scan.scannedItems}
        prefersReducedMotion={prefersReducedMotion}
      />

      {!scan.isConnected && (
        <MobileScanConnectionBanner
          reconnectAttempts={scan.reconnectAttempts}
          onRetry={scan.retryConnection}
        />
      )}

      <MobileScanToast toast={scan.toast} prefersReducedMotion={prefersReducedMotion} />
    </div>
  );
}
