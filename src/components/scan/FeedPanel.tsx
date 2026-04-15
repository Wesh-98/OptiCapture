import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Save, Image as ImageIcon, Loader2, AlertTriangle,
  Pencil, Trash2, Smartphone, ScanBarcode,
} from 'lucide-react';
import { cn, formatServerTime } from '../../lib/utils';
import type { SessionItem, UiStatus } from './types';

function StatusBadge({ item }: Readonly<{ item: SessionItem }>) {
  if (item.exists_in_inventory === 1) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">In Stock</span>;
  }
  if (item.lookup_status === 'new_candidate') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">New</span>;
  }
  return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Unknown</span>;
}

function SourcePill({ source }: Readonly<{ source: string | null }>) {
  if (!source || source === 'scan_only') return null;
  const label =
    source === 'open_food_facts' ? 'OFF' :
    source === 'upcitemdb' ? 'UPC DB' :
    source === 'inventory' ? 'Inventory' : source;
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-100 text-slate-500 border border-slate-200">
      {label}
    </span>
  );
}

interface Props {
  items: SessionItem[];
  visibleItems: SessionItem[];
  selectedIds: Set<number>;
  uiStatus: UiStatus;
  statusMessage: string;
  sessionStatus: 'active' | 'draft' | 'completed' | null;
  sessionLabel: string | null;
  pollError: string | null;
  draftAlert: { message: string; visible: boolean };
  isTaker: boolean;
  prefersReducedMotion: boolean | null;
  scanInputMode: 'mobile' | 'hardware';
  showDraftPopover: boolean;
  draftNameInput: string;
  RENDER_LIMIT: number;
  onToggleItem: (id: number) => void;
  onCommitClick: () => void;
  onOpenDraftPopover: () => void;
  onCloseDraftPopover: () => void;
  onDraftNameChange: (v: string) => void;
  onConfirmDraft: (label: string) => void;
  onResumeScan: () => void;
  onSaveDraft: () => void;
  onDismissAlert: () => void;
  onClearAllItems: () => void;
  onDeleteDraft: () => void;
  onEditItem: (item: SessionItem) => void;
  onDeleteItem: (id: number) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onSelectNewOnly: () => void;
}

export function FeedPanel({
  items, visibleItems, selectedIds, uiStatus, statusMessage, sessionStatus,
  sessionLabel, pollError, draftAlert, isTaker, prefersReducedMotion,
  scanInputMode, showDraftPopover, draftNameInput, RENDER_LIMIT,
  onToggleItem, onCommitClick, onOpenDraftPopover, onCloseDraftPopover,
  onDraftNameChange, onConfirmDraft, onResumeScan, onSaveDraft, onDismissAlert,
  onClearAllItems, onDeleteDraft, onEditItem, onDeleteItem,
  onSelectAll, onDeselectAll, onSelectNewOnly,
}: Readonly<Props>) {
  const newItems = items.filter(i => i.lookup_status === 'new_candidate' && !i.exists_in_inventory);
  const inStockItems = items.filter(i => i.exists_in_inventory === 1);
  const unknownItems = items.filter(i => i.lookup_status !== 'new_candidate' && !i.exists_in_inventory);
  const allSelected = items.length > 0 && items.every(i => selectedIds.has(i.id));

  return (
    <div className="lg:col-span-2 flex flex-col h-[780px] bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Feed header */}
      <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="h-8 w-1 bg-emerald-500 rounded-full" />
          <div>
            <h3 className="font-bold text-navy-900">Incoming Feed</h3>
            <p className="text-xs text-slate-500">{items.length} items scanned</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && !isTaker && (
            <button
              onClick={onCommitClick}
              disabled={uiStatus === 'committing'}
              className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-900/20 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {uiStatus === 'committing' ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Save size={18} />
              )}
              Commit Selected ({selectedIds.size})
            </button>
          )}
          {sessionStatus === 'active' && items.length > 0 && (
            <div className="relative">
              <button
                onClick={onOpenDraftPopover}
                className="px-4 py-2 bg-[#1e3a5f] text-white rounded-xl text-sm font-semibold hover:bg-[#16304f] transition-colors"
              >
                Save as Draft
              </button>
              {showDraftPopover && (
                <div className="absolute right-0 top-full mt-2 z-30 bg-white border border-slate-200 rounded-xl shadow-lg p-3 w-64">
                  <p className="text-xs font-semibold text-slate-600 mb-2">Name this draft (optional)</p>
                  <input
                    autoFocus
                    type="text"
                    value={draftNameInput}
                    onChange={e => onDraftNameChange(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { onConfirmDraft(draftNameInput); }
                      else if (e.key === 'Escape') { onCloseDraftPopover(); }
                    }}
                    placeholder="e.g. Morning scan·Aisle 3"
                    className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 mb-2"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => onConfirmDraft(draftNameInput)}
                      className="flex-1 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700"
                    >
                      Save Draft
                    </button>
                    <button
                      onClick={onCloseDraftPopover}
                      className="px-3 py-1.5 border border-slate-200 text-slate-500 rounded-lg text-xs hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {sessionStatus === 'draft' && (
            <button
              onClick={onResumeScan}
              className="px-4 py-2 border border-amber-300 text-amber-700 rounded-xl text-sm font-semibold hover:bg-amber-50 transition-colors"
            >
              Resume Scanning
            </button>
          )}
        </div>
      </div>

      {/* Status + counts bar */}
      <div className="px-4 py-2.5 border-b border-slate-100 bg-white flex flex-wrap items-center gap-3 text-sm">
        <span className={cn(
          'px-2.5 py-1 rounded-full font-medium text-xs',
          uiStatus === 'error' ? 'bg-red-50 text-red-600'
          : uiStatus === 'committing' ? 'bg-amber-50 text-amber-700'
          : uiStatus === 'ready' ? 'bg-emerald-50 text-emerald-700'
          : 'bg-slate-100 text-slate-600'
        )}>
          {statusMessage}
        </span>
        {items.length > 0 && (
          <>
            <button
              onClick={allSelected ? onDeselectAll : onSelectAll}
              className="text-xs text-slate-500 hover:text-navy-900 underline underline-offset-2"
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
            <button
              onClick={onSelectNewOnly}
              className="text-xs text-emerald-600 hover:text-emerald-800 underline underline-offset-2"
            >
              New Only
            </button>
            <span className="text-xs text-emerald-700 font-semibold">New: {newItems.length}</span>
            <span className="text-xs text-slate-600 font-semibold">In Stock: {inStockItems.length}</span>
            <span className="text-xs text-amber-700 font-semibold">Unknown: {unknownItems.length}</span>
          </>
        )}
        {pollError && (
          <span className="inline-flex items-center gap-1 text-xs text-red-600 ml-auto">
            <AlertTriangle size={13} />
            {pollError}
          </span>
        )}
      </div>

      {/* Draft alert banner */}
      {draftAlert.visible && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 mx-4">
          <span className="flex-1">{draftAlert.message}</span>
          <button
            onClick={onSaveDraft}
            className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 shrink-0"
          >
            Save as Draft
          </button>
          <button
            onClick={onDismissAlert}
            className="text-amber-600 hover:text-amber-800 shrink-0 text-lg leading-none"
          >
            Ã—
          </button>
        </div>
      )}

      {/* Committed (read-only) banner */}
      {sessionStatus === 'completed' && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm mx-4" style={{ background: '#eef2f8', border: '1px solid #b6c8e0', color: '#1e3a5f' }}>
          <span className="text-lg">âœ…</span>
          <span className="flex-1">
            {sessionLabel
              ? <><strong>{sessionLabel}</strong> â€” committed to inventory. View only.</>
              : 'This session has been committed to inventory â€” view only.'}
          </span>
        </div>
      )}

      {/* Draft mode banner */}
      {sessionStatus === 'draft' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 mx-4">
          {/* <span className="text-lg">🔒</span> */}
          <span className="flex-1">
            {sessionLabel
              ? <><strong>{sessionLabel}</strong> Draft Mode. Scanning paused.</>
              : 'Draft Mode. Scanning paused. Edit items below, then commit or resume scanning.'}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClearAllItems}
              className="px-3 py-1.5 border border-amber-300 text-amber-700 rounded-lg text-xs font-semibold hover:bg-amber-100 transition-colors"
            >
              Clear Items
            </button>
            <button
              onClick={onDeleteDraft}
              className="px-3 py-1.5 border border-red-300 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-50 transition-colors"
            >
              Delete Draft
            </button>
            <button
              onClick={onResumeScan}
              className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 transition-colors"
            >
              Resume Scanning
            </button>
          </div>
        </div>
      )}

      {/* Item list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50">
        <AnimatePresence mode="popLayout">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center px-6">
              {scanInputMode === 'hardware' ? (
                <>
                  <ScanBarcode size={36} className="mb-3 text-slate-300" />
                  <p className="font-medium">Ready for scans...</p>
                  <p className="text-sm text-slate-400 mt-1">
                    Scanner is listening. Pull the trigger on any barcode to add items.
                  </p>
                </>
              ) : (
                <>
                  <Smartphone size={36} className="mb-3 text-slate-300" />
                  <p className="font-medium">Ready for scans...</p>
                  <p className="text-sm text-slate-400 mt-1">
                    Use the QR code on the left to connect your phone and start scanning items.
                  </p>
                </>
              )}
            </div>
          ) : (
            visibleItems.map(item => {
              const selected = selectedIds.has(item.id);
              const displayUnit = item.unit?.trim() ?? '';
              return (
                <motion.div
                  key={item.id}
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
                  animate={prefersReducedMotion ? {} : { opacity: 1, y: 0, scale: 1 }}
                  exit={prefersReducedMotion ? {} : { opacity: 0, y: -8 }}
                  layout
                  className={cn(
                    'bg-white rounded-xl border transition-all',
                    selected && item.exists_in_inventory ? 'border-slate-400 shadow-sm'
                    : selected ? 'border-emerald-400 shadow-sm shadow-emerald-50 ring-1 ring-emerald-100'
                    : 'border-slate-300'
                  )}
                >
                  <div className="flex items-start gap-2 p-2">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggleItem(item.id)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 shrink-0 cursor-pointer"
                    />
                    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200 shrink-0">
                      {item.image ? (
                        <img src={item.image} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon size={16} className="text-slate-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <p className="text-sm font-semibold leading-tight text-navy-900">
                              {item.product_name || (
                                <span className="text-slate-400 italic">No product name</span>
                              )}
                            </p>
                            {displayUnit && (
                              <span className="text-sm font-medium text-slate-600">
                                {displayUnit}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 break-all text-xs">
                            <span className="text-slate-500">UPC:</span>{' '}
                            <span className="font-medium text-slate-700">{item.upc}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <StatusBadge item={item} />
                          {sessionStatus !== 'completed' && (<>
                            <button
                              onClick={() => onEditItem(item)}
                              className="p-1 text-slate-400 hover:text-navy-700 hover:bg-slate-100 rounded transition-colors"
                              title="Edit item"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => onDeleteItem(item.id)}
                              className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Remove from session"
                            >
                              <Trash2 size={13} />
                            </button>
                          </>)}
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3 text-xs">
                        <div className="min-w-0 flex-1">
                          {item.brand && (
                            <p className="truncate">
                              <span className="text-slate-500">Brand:</span>{' '}
                              <span className="font-medium text-slate-700">{item.brand}</span>
                            </p>
                          )}
                        </div>
                        <div className="ml-auto shrink-0">
                          <SourcePill source={item.source} />
                        </div>
                        <span className="shrink-0 font-medium text-slate-600">
                          Scanned {formatServerTime(item.scanned_at)}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 rounded-lg bg-navy-50 px-2.5 py-1 font-mono text-sm font-bold text-navy-700 self-center">
                      x{item.quantity}
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
        {items.length > RENDER_LIMIT && (
          <div className="py-3 text-center text-xs text-slate-400">
            Showing {RENDER_LIMIT} of {items.length} items - all items included in commit
          </div>
        )}
      </div>
    </div>
  );
}

