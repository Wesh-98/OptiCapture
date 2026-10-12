import type { ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { ToastContainer } from '../components/scan/ToastContainer';
import { ToastContext, useToastState } from '../hooks/useToast';

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { toasts, addToast } = useToastState();
  const prefersReducedMotion = useReducedMotion();
  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <ToastContainer toasts={toasts} prefersReducedMotion={prefersReducedMotion} />
    </ToastContext.Provider>
  );
}
