import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import type { Toast } from './types';

interface Props {
  toasts: Toast[];
  prefersReducedMotion: boolean | null;
}

export function ToastContainer({ toasts, prefersReducedMotion }: Readonly<Props>) {
  return (
    <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 space-y-2">
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
            animate={prefersReducedMotion ? {} : { opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? {} : { opacity: 0, y: -20 }}
            className={cn(
              'px-4 py-3 rounded-lg shadow-lg font-medium text-sm max-w-md',
              toast.type === 'success' && 'bg-emerald-600 text-white',
              toast.type === 'error' && 'bg-red-600 text-white',
              toast.type === 'warning' && 'bg-amber-600 text-white'
            )}
          >
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
