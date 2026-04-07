import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, X } from 'lucide-react';
import type { ActiveSession } from './types';

interface SessionCardProps {
  session: ActiveSession;
  onDelete: (sessionId: string) => void;
  now: number;
}

function SessionCard({ session: s, onDelete, now }: Readonly<SessionCardProps>) {
  const navigate = useNavigate();
  const isActive = s.status === 'active';
  const isCompleted = s.status === 'completed';
  const itemWord = s.item_count === 1 ? 'item' : 'items';
  const lastActivity = s.last_scan_at || s.created_at;
  const diffMs = now - new Date(lastActivity).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const isToday = diffMs < 24 * 60 * 60 * 1000;
  const timeAgo = diffMin < 60
    ? `${diffMin}m ago`
    : diffMin < 1440
    ? `${Math.floor(diffMin / 60)}h ago`
    : `${Math.floor(diffMin / 1440)}d ago`;

  const cardClass = isCompleted
    ? 'bg-[#eef2f8] border border-[#b6c8e0] border-l-[#1e3a5f]'
    : !isToday
    ? 'bg-slate-50 border border-slate-200 border-l-slate-400 opacity-75'
    : isActive
    ? 'bg-emerald-50/60 border border-emerald-200 border-l-emerald-500'
    : 'bg-amber-50/60 border border-amber-200 border-l-amber-500';

  const dotClass = isCompleted ? 'bg-[#1e3a5f]' : isActive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400';
  const labelClass = isCompleted ? 'text-[#1e3a5f]' : isActive ? 'text-emerald-800' : 'text-amber-800';
  const statusText = isCompleted ? 'Committed' : isActive ? 'Scanning' : 'Draft';
  const btnLabel = isCompleted ? 'View' : isActive ? 'Open' : 'Review';
  const btnClass = isCompleted
    ? 'bg-[#1e3a5f] text-white hover:bg-[#16304f]'
    : !isToday
    ? 'bg-slate-500 text-white hover:bg-slate-600'
    : isActive
    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
    : 'bg-amber-500 text-white hover:bg-amber-600';

  return (
    <div className={`relative rounded-xl p-3 flex flex-col gap-2 min-w-[160px] max-w-[200px] border-l-4 ${cardClass}`}>
      {!isCompleted && (
        <button
          onClick={() => onDelete(s.session_id)}
          className="absolute top-2 right-2 text-slate-400 hover:text-red-500 transition-colors"
          title="Delete session"
        >
          <X size={13} />
        </button>
      )}
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
        <span className={`text-xs font-semibold ${labelClass}`}>{statusText}</span>
      </div>
      <div>
        {s.label && (
          <p className="text-xs font-semibold text-slate-700 truncate pr-4" title={s.label}>{s.label}</p>
        )}
        <p className="text-lg font-bold text-slate-900">{s.item_count} <span className="text-sm font-normal text-slate-600">{itemWord}</span></p>
        <p className="text-xs text-slate-500">{timeAgo}</p>
      </div>
      <button
        onClick={() => navigate(`/scan?session=${s.session_id}`)}
        className={`w-full py-1.5 rounded-lg text-xs font-semibold transition-colors ${btnClass}`}
      >
        {btnLabel}
      </button>
    </div>
  );
}

interface Props {
  sessions: ActiveSession[];
  isOpen: boolean;
  onToggle: () => void;
  onDelete: (sessionId: string) => void;
  onNewScan: () => void;
}

export function SessionsSection({ sessions, isOpen, onToggle, onDelete, onNewScan }: Readonly<Props>) {
  if (sessions.length === 0) return null;
  const now = Date.now();
  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onToggle} className="flex items-center gap-2 flex-1">
          <span className="text-sm font-semibold" style={{ color: '#1e3a5f' }}>Scan Sessions</span>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{sessions.length}</span>
          <ChevronDown size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        <button
          onClick={onNewScan}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#1e3a5f] text-white hover:bg-[#16304f] transition-colors shrink-0"
        >
          + New Scan
        </button>
      </div>
      {isOpen && (
        <div className="px-4 pb-4 pt-1 flex flex-wrap gap-3 border-t border-slate-100">
          {sessions.map(s => (
            <SessionCard key={s.session_id} session={s} onDelete={onDelete} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
