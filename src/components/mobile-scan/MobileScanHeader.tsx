interface MobileScanHeaderProps {
  isConnected: boolean;
  scanCount: number;
  sessionId?: string;
}

export function MobileScanHeader({
  isConnected,
  scanCount,
  sessionId,
}: MobileScanHeaderProps) {
  return (
    <div className="shrink-0 flex items-center px-4 py-3">
      <div className="flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${
            isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400 animate-pulse'
          }`}
        />
        <span className="text-xs font-mono text-slate-400">
          {sessionId?.slice(0, 8) || 'unknown'}
        </span>
      </div>

      <div className="flex-1 flex flex-col items-center">
        <span className="text-4xl font-black text-white">{scanCount}</span>
        <span className="text-xs text-slate-600">items scanned</span>
      </div>

      <div className="w-16" />
    </div>
  );
}
