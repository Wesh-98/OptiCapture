import type { FormEvent } from 'react';

interface MobileScanManualFormProps {
  manualItemName: string;
  manualInput: string;
  isProcessing: boolean;
  onItemNameChange: (value: string) => void;
  onInputChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function MobileScanManualForm({
  manualItemName,
  manualInput,
  isProcessing,
  onItemNameChange,
  onInputChange,
  onSubmit,
}: MobileScanManualFormProps) {
  return (
    <div className="shrink-0 mx-4 mt-3 space-y-3">
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="text"
          value={manualItemName}
          onChange={event => onItemNameChange(event.target.value)}
          placeholder="Item name (optional)"
          className="w-full px-4 py-3 bg-white/[0.08] border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          disabled={isProcessing}
        />

        <input
          type="text"
          inputMode="numeric"
          value={manualInput}
          onChange={event => onInputChange(event.target.value)}
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
          {isProcessing ? 'Adding...' : 'Add Item'}
        </button>
      </form>
    </div>
  );
}
