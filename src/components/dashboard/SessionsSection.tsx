import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, X } from 'lucide-react';
import { parseServerDate } from '../../lib/utils';
import type { ActiveSession } from './types';

type SessionTone = ActiveSession['status'] | 'stale';

const STATUS_STYLE: Record<
  ActiveSession['status'],
  { dotClass: string; labelClass: string; statusText: string; btnLabel: string }
> = {
  completed: {
    dotClass: 'bg-brand-400',
    labelClass: 'text-brand-600',
    statusText: 'Committed',
    btnLabel: 'View',
  },
  active: {
    dotClass: 'bg-emerald-500 animate-pulse',
    labelClass: 'text-emerald-800',
    statusText: 'Scanning',
    btnLabel: 'Open',
  },
  draft: {
    dotClass: 'bg-amber-400',
    labelClass: 'text-amber-800',
    statusText: 'Draft',
    btnLabel: 'Review',
  },
};

const TONE_STYLE: Record<SessionTone, { cardClass: string; btnClass: string }> = {
  completed: {
    cardClass: 'bg-theme-subtle border border-theme-border border-l-brand-400',
    btnClass: 'bg-theme-text text-white hover:bg-navy-800',
  },
  stale: {
    cardClass: 'bg-slate-50 border border-slate-200 border-l-slate-400 opacity-75',
    btnClass: 'bg-slate-500 text-white hover:bg-slate-600',
  },
  active: {
    cardClass: 'bg-emerald-50/60 border border-emerald-200 border-l-emerald-500',
    btnClass: 'bg-emerald-600 text-white hover:bg-emerald-700',
  },
  draft: {
    cardClass: 'bg-amber-50/60 border border-amber-200 border-l-amber-500',
    btnClass: 'bg-amber-500 text-white hover:bg-amber-600',
  },
};

/** An unfinished session nobody touched in the last day is shown greyed out. */
function sessionTone(status: ActiveSession['status'], isToday: boolean): SessionTone {
  if (status === 'completed' || isToday) return status;
  return 'stale';
}

function formatTimeAgo(diffMin: number): string {
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
  return `${Math.floor(diffMin / 1440)}d ago`;
}

interface SessionCardProps {
  session: ActiveSession;
  onDelete: (sessionId: string) => void;
  now: number;
}

function SessionCard({ session: s, onDelete, now }: Readonly<SessionCardProps>) {
  const navigate = useNavigate();
  // Deleting throws away every scan in the session, so the X asks first.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isActive = s.status === 'active';
  const isCompleted = s.status === 'completed';
  const itemWord = s.item_count === 1 ? 'item' : 'items';
  const lastActivity = s.last_scan_at || s.created_at;
  const diffMs = now - parseServerDate(lastActivity).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const isToday = diffMs < 24 * 60 * 60 * 1000;
  const status = isActive || isCompleted ? s.status : 'draft';
  const { dotClass, labelClass, statusText, btnLabel } = STATUS_STYLE[status];
  const { cardClass, btnClass } = TONE_STYLE[sessionTone(status, isToday)];
  const timeAgo = formatTimeAgo(diffMin);

  return (
    <div
      className={`relative rounded-xl p-3 flex flex-col gap-2 min-w-[160px] max-w-[200px] border-l-4 ${cardClass}`}
    >
      {!isCompleted && (
        <button
          onClick={() => setConfirmingDelete(true)}
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
          <p className="text-xs font-semibold text-slate-700 truncate pr-4" title={s.label}>
            {s.label}
          </p>
        )}
        <p className="text-lg font-bold text-slate-900">
          {s.item_count} <span className="text-sm font-normal text-slate-600">{itemWord}</span>
        </p>
        <p className="text-xs text-slate-500">{timeAgo}</p>
      </div>
      {confirmingDelete ? (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-accent-600">
            Delete this session and its {itemWord}?
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => setConfirmingDelete(false)}
              className="flex-1 py-1.5 rounded-lg border border-theme-border bg-white text-xs font-semibold text-theme-text hover:bg-theme-subtle transition-colors"
            >
              Keep
            </button>
            <button
              onClick={() => {
                setConfirmingDelete(false);
                onDelete(s.session_id);
              }}
              className="flex-1 py-1.5 rounded-lg bg-accent-600 text-xs font-semibold text-white hover:bg-accent-700 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => navigate(`/scan?session=${s.session_id}`)}
          className={`w-full py-1.5 rounded-lg text-xs font-semibold transition-colors ${btnClass}`}
        >
          {btnLabel}
        </button>
      )}
    </div>
  );
}

interface Props {
  sessions: ActiveSession[];
  isOpen: boolean;
  now: number;
  onToggle: () => void;
  onDelete: (sessionId: string) => void;
  onNewScan: () => void;
}

export function SessionsSection({
  sessions,
  isOpen,
  now,
  onToggle,
  onDelete,
  onNewScan,
}: Readonly<Props>) {
  if (sessions.length === 0) return null;
  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onToggle} className="flex items-center gap-2 flex-1">
          <span className="text-sm font-semibold text-brand-600">Scan Sessions</span>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
            {sessions.length}
          </span>
          <ChevronDown
            size={16}
            className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
        <button
          onClick={onNewScan}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-theme-text text-white hover:bg-navy-800 transition-colors shrink-0"
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
