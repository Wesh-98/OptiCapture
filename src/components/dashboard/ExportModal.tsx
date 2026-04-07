import React from 'react';
import { Loader2, Download } from 'lucide-react';

type ExportFormat = 'xlsx' | 'csv' | 'json' | 'pdf';

interface Props {
  isOpen: boolean;
  exportFormat: ExportFormat;
  exporting: boolean;
  onFormatChange: (f: ExportFormat) => void;
  onExport: () => void;
  onClose: () => void;
}

const FORMATS = [
  { id: 'xlsx' as const, label: 'Excel', desc: '.xlsx — re-importable' },
  { id: 'csv'  as const, label: 'CSV',   desc: '.csv — universal' },
  { id: 'json' as const, label: 'JSON',  desc: '.json — full backup' },
  { id: 'pdf'  as const, label: 'PDF',   desc: '.pdf — print report' },
];

export function ExportModal({ isOpen, exportFormat, exporting, onFormatChange, onExport, onClose }: Readonly<Props>) {
  if (!isOpen) return null;
  return (
    <div role="presentation" aria-hidden="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-navy-900 mb-1">Export Inventory</h3>
        <p className="text-sm text-slate-500 mb-4">Choose a format to download your inventory.</p>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {FORMATS.map(f => (
            <button key={f.id} onClick={() => onFormatChange(f.id)}
              className={`p-3 rounded-xl border text-left transition-colors ${exportFormat === f.id ? 'bg-navy-900 border-navy-900' : 'border-slate-200 hover:bg-slate-50'}`}>
              <p className={`text-sm font-semibold ${exportFormat === f.id ? 'text-white' : 'text-slate-800'}`}>{f.label}</p>
              <p className={`text-xs mt-0.5 ${exportFormat === f.id ? 'text-slate-300' : 'text-slate-400'}`}>{f.desc}</p>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
          <button onClick={onExport} disabled={exporting}
            className="flex-1 px-4 py-2 rounded-lg bg-navy-900 text-white text-sm font-medium hover:bg-navy-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
            {exporting ? <><Loader2 size={14} className="animate-spin" /> Exporting...</> : <><Download size={14} /> Download</>}
          </button>
        </div>
      </div>
    </div>
  );
}
