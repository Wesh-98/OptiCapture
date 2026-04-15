import { useState } from 'react';
import type { ActiveSession } from '../components/dashboard/types';

//loads active/draft sessions
export function useActiveSessions() {
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [sessionsOpen, setSessionsOpen] = useState(false);

  const fetchActiveSessions = async () => {
    try {
      const res = await fetch('/api/sessions/active', { credentials: 'include' });
      if (res.ok) setActiveSessions(await res.json());
    } catch { /* ignore */ }
  };

  const deleteSession = async (sessionId: string) => {
    setActiveSessions(prev => prev.filter(s => s.session_id !== sessionId));
    try {
      const res = await fetch(`/api/session/${sessionId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) await fetchActiveSessions();
    } catch {
      await fetchActiveSessions();
    }
  };

  return { activeSessions, sessionsOpen, setSessionsOpen, fetchActiveSessions, deleteSession };
}
