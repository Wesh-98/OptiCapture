import { CheckCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ScannedItem } from './types';
import { formatServerTime } from '../../lib/utils';

interface MobileScanItemsListProps {
  items: ScannedItem[];
  prefersReducedMotion: boolean;
}

export function MobileScanItemsList({
  items,
  prefersReducedMotion,
}: MobileScanItemsListProps) {
  return (
    <div className="flex-1 overflow-y-auto mx-4 mt-3 pb-2 min-h-0">
      {items.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-slate-700 text-sm">No items scanned yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {items.map(item => (
              <motion.div
                key={item.id}
                initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
                animate={prefersReducedMotion ? {} : { opacity: 1, height: 'auto' }}
                exit={prefersReducedMotion ? {} : { opacity: 0, height: 0 }}
                className="flex items-start gap-3 rounded-xl bg-white/5 px-3 py-2.5"
              >
                <CheckCircle size={16} className="text-emerald-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold text-white">{item.name}</span>
                    {item.unit && (
                      <span className="text-sm font-medium text-emerald-300">{item.unit}</span>
                    )}
                  </div>
                  <p className="mt-1 break-all text-xs font-medium tracking-wide text-slate-300">
                    UPC {item.upc}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {item.quantity > 1 && (
                    <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                      x{item.quantity}
                    </span>
                  )}
                  <p className="mt-1 text-xs text-slate-500">{formatServerTime(item.ts)}</p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
