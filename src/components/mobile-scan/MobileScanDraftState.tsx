import { AlertTriangle } from 'lucide-react';

interface MobileScanDraftStateProps {
  scanCount: number;
}

export function MobileScanDraftState({ scanCount }: MobileScanDraftStateProps) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#0d1117] text-white px-6 gap-6">
      <div className="w-14 h-14 rounded-full bg-amber-500/20 flex items-center justify-center">
        <AlertTriangle size={28} className="text-amber-400" />
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
