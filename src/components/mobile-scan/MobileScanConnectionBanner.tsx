interface MobileScanConnectionBannerProps {
  reconnectAttempts: number;
  onRetry: () => void;
}

export function MobileScanConnectionBanner({
  reconnectAttempts,
  onRetry,
}: MobileScanConnectionBannerProps) {
  return (
    <div className="shrink-0 mx-4 mb-2 flex items-center gap-2 px-3 py-2 bg-amber-500/20 border border-amber-500/30 rounded-xl text-sm text-amber-300">
      <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
      <span className="flex-1">
        {reconnectAttempts < 3
          ? 'Connection lost - reconnecting...'
          : 'Unable to reach server. Check your network.'}
      </span>
      {reconnectAttempts >= 3 && (
        <button
          onClick={onRetry}
          className="text-xs font-semibold underline underline-offset-2 text-amber-300"
        >
          Retry now
        </button>
      )}
    </div>
  );
}
