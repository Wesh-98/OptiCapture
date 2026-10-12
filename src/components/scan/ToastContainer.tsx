import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, CheckCircle2, XCircle, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Toast } from './types';

interface Props {
  toasts: Toast[];
  prefersReducedMotion: boolean | null;
}

// A white card with a coloured icon and edge: teal for done, red for caution and errors.
const STYLES: Record<Toast['type'], { icon: LucideIcon; tone: string; label: string }> = {
  success: { icon: CheckCircle2, tone: 'text-brand-600 border-l-brand-600', label: 'Done' },
  warning: { icon: AlertTriangle, tone: 'text-accent-600 border-l-accent-600', label: 'Caution' },
  error: { icon: XCircle, tone: 'text-accent-600 border-l-accent-600', label: 'Error' },
};

export function ToastContainer({ toasts, prefersReducedMotion }: Readonly<Props>) {
  return (
    // Above open modals (z-50), and announced to screen readers as it appears.
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-[60] space-y-2 w-[calc(100%-2rem)] max-w-md"
    >
      <AnimatePresence>
        {toasts.map(toast => {
          const { icon: Icon, tone, label } = STYLES[toast.type];
          return (
            <motion.div
              key={toast.id}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
              animate={prefersReducedMotion ? {} : { opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? {} : { opacity: 0, y: -20 }}
              className={cn(
                'flex items-start gap-3 rounded-lg border border-theme-border border-l-4 bg-white px-4 py-3 shadow-lg',
                tone
              )}
            >
              <Icon size={18} className="mt-0.5 shrink-0" aria-label={label} />
              <p className="text-sm font-medium text-black">{toast.message}</p>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
