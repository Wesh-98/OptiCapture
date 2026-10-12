import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Toast } from '../components/scan/types';

export type ToastType = Toast['type'];
export type AddToast = (type: ToastType, message: string) => void;

const TOAST_MS = 3000;

/** The toast list and its timers. ToastProvider owns the one instance the app shares. */
export function useToastState() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nextIdRef = useRef(0);

  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout);
    },
    []
  );

  const addToast = useCallback<AddToast>((type, message) => {
    nextIdRef.current += 1;
    const id = String(nextIdRef.current);
    setToasts(prev => [...prev, { id, type, message }]);
    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timersRef.current = timersRef.current.filter(t => t !== timer);
    }, TOAST_MS);
    timersRef.current.push(timer);
  }, []);

  return { toasts, addToast };
}

export const ToastContext = createContext<AddToast | null>(null);

// Every page shares one toast stack, so a toast raised just before navigating (or by a hook
// on a page without its own container) still shows.
export function useToast(): { addToast: AddToast } {
  const addToast = useContext(ToastContext);
  if (!addToast) throw new Error('useToast must be used inside ToastProvider');
  return { addToast };
}
