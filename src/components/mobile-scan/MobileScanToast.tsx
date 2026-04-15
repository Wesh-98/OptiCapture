import { AlertTriangle, CheckCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ScanToast } from './types';

interface MobileScanToastProps {
  toast: ScanToast | null;
  prefersReducedMotion: boolean;
}

export function MobileScanToast({ toast, prefersReducedMotion }: MobileScanToastProps) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={prefersReducedMotion ? false : { y: 80, opacity: 0 }}
          animate={prefersReducedMotion ? {} : { y: 0, opacity: 1 }}
          exit={prefersReducedMotion ? {} : { y: 80, opacity: 0 }}
          transition={
            prefersReducedMotion ? {} : { type: 'spring', stiffness: 400, damping: 30 }
          }
          className={`fixed bottom-6 left-4 right-4 z-50 px-4 py-3 rounded-2xl flex items-center gap-3 shadow-2xl ${
            toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle size={20} className="text-white shrink-0" />
          ) : (
            <AlertTriangle size={20} className="text-white shrink-0" />
          )}
          <span className="text-white text-sm font-medium">{toast.message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
