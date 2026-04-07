import { useCallback, useEffect, useRef, useState } from 'react';
import type { Toast } from '../components/scan/types';

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  const addToast = useCallback((type: 'success' | 'error' | 'warning', message: string) => {
    const id = Math.random().toString(36).slice(2, 11);
    setToasts(prev => [...prev, { id, type, message }]);
    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timersRef.current = timersRef.current.filter(t => t !== timer);
    }, 3000);
    timersRef.current.push(timer);
  }, []);

  return { toasts, addToast };
}
