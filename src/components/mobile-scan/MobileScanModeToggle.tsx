import { Camera, Keyboard } from 'lucide-react';
import type { MobileScanInputMode } from './types';

interface MobileScanModeToggleProps {
  inputMode: MobileScanInputMode;
  onChange: (mode: MobileScanInputMode) => void;
}

export function MobileScanModeToggle({ inputMode, onChange }: MobileScanModeToggleProps) {
  return (
    <div className="shrink-0 mx-4 mt-3 flex bg-white/5 rounded-2xl p-1">
      <button
        onClick={() => onChange('camera')}
        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-colors ${
          inputMode === 'camera' ? 'bg-emerald-600 text-white' : 'text-slate-500'
        }`}
      >
        <Camera size={16} />
        Camera
      </button>

      <button
        onClick={() => onChange('manual')}
        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-colors ${
          inputMode === 'manual' ? 'bg-emerald-600 text-white' : 'text-slate-500'
        }`}
      >
        <Keyboard size={16} />
        Manual
      </button>
    </div>
  );
}
