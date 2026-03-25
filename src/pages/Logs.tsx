import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { format } from 'date-fns';
import { Search, Filter, ChevronDown, PlusCircle, Pencil, Trash2, Upload, Layers, LogIn, ListFilter, X, Download, ChevronLeft, ChevronRight, History, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';

interface Log {
  id: number;
  action: string;
  details: string;
  username: string;
  timestamp: string;
}

const actionTypes = ['All', 'CREATE', 'UPDATE', 'DELETE', 'IMPORT', 'BATCH', 'EXPORT', 'LOGIN'];

const getActionBadgeColor = (action: string): string => {
  switch (action) {
    case 'CREATE':
      return 'bg-emerald-100 text-emerald-700';
    case 'UPDATE':
      return 'bg-blue-100 text-blue-700';
    case 'DELETE':
      return 'bg-red-100 text-red-700';
    case 'IMPORT':
      return 'bg-purple-100 text-purple-700';
    case 'BATCH':
      return 'bg-amber-100 text-amber-700';
    case 'EXPORT':
      return 'bg-teal-100 text-teal-700';
    case 'LOGIN':
      return 'bg-slate-100 text-slate-600';
    default:
      return 'bg-slate-100 text-slate-600';
  }
};

const getActionIcon = (action: string) => {
  switch (action) {
    case 'All': return ListFilter;
    case 'CREATE': return PlusCircle;
    case 'UPDATE': return Pencil;
    case 'DELETE': return Trash2;
    case 'IMPORT': return Upload;
    case 'BATCH': return Layers;
    case 'EXPORT': return Download;
    case 'LOGIN': return LogIn;
    default: return ListFilter;
  }
};

const getActionDotColor = (action: string): string => {
  switch (action) {
    case 'CREATE': return 'bg-emerald-500';
    case 'UPDATE': return 'bg-blue-500';
    case 'DELETE': return 'bg-red-500';
    case 'IMPORT': return 'bg-purple-500';
    case 'BATCH': return 'bg-amber-500';
    case 'EXPORT': return 'bg-teal-500';
    case 'LOGIN': return 'bg-slate-400';
    default: return '';
  }
};

export default function Logs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [actionFilter, setActionFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState<50 | 100 | 200>(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [fetchError, setFetchError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setFetchError('');
    try {
      const res = await fetch('/api/logs', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch logs');
      setLogs(await res.json());
    } catch {
      setFetchError('Could not load activity logs. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => { setCurrentPage(1); }, [actionFilter]);
  useEffect(() => { setCurrentPage(1); }, [search]);

  const filteredLogs = useMemo(() => {
    let filtered = logs;

    // Apply action filter
    if (actionFilter !== 'All') {
      filtered = filtered.filter(log => log.action === actionFilter);
    }

    // Apply search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(log =>
        log.details.toLowerCase().includes(searchLower) ||
        log.username.toLowerCase().includes(searchLower)
      );
    }

    return filtered;
  }, [logs, actionFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const pagedLogs = filteredLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-navy-900">Activity Logs</h2>
        <p className="text-slate-500">Audit trail of all system actions</p>
      </div>

      {/* Search and Filter Controls */}
      <div className="space-y-4">
        {/* Search and Filter in one row */}
        <div className="flex items-center gap-3">
          {/* Search — narrower, not full width */}
          <div className="relative w-1/2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search by username or details..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg leading-5 bg-white placeholder-slate-500 focus:outline-none focus:placeholder-slate-400 focus:ring-1 focus:ring-navy-900 focus:border-navy-900"
            />
          </div>

          {/* Filter button */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setFilterOpen(o => !o)}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white hover:bg-slate-50 transition-colors"
            >
              <Filter size={15} className="text-slate-500" />
              <span className="text-slate-700 font-medium">{actionFilter === 'All' ? 'Filter' : actionFilter}</span>
              <ChevronDown size={14} className="text-slate-400" />
            </button>

            {/* Dropdown */}
            {filterOpen && (
              <div className="absolute right-0 mt-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200 z-20 py-1">
                {actionTypes.map((action, index) => {
                  const Icon = getActionIcon(action);
                  const dotColor = getActionDotColor(action);

                  return (
                    <React.Fragment key={action}>
                      <button
                        onClick={() => {
                          setActionFilter(action);
                          setFilterOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50 transition-colors ${
                          actionFilter === action ? 'text-navy-900 font-semibold' : 'text-slate-700'
                        }`}
                      >
                        <Icon size={15} className="text-slate-500 shrink-0" />
                        <span className="flex-1 text-left">{action}</span>
                        {action !== 'All' && <span className={`w-2 h-2 rounded-full ${dotColor}`} />}
                      </button>
                      {index === 0 && <div className="border-t border-slate-100 my-1" />}
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Results Count */}
        <div className="flex items-center gap-2 text-sm text-slate-500">
          Showing {filteredLogs.length} of {logs.length} logs
          {actionFilter !== 'All' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-navy-900 text-white text-xs font-medium">
              {actionFilter}
              <button onClick={() => setActionFilter('All')} className="hover:opacity-80">
                <X size={10} />
              </button>
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">Loading logs...</span>
        </div>
      ) : fetchError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
          <AlertTriangle size={32} className="text-red-400 opacity-70" />
          <p className="text-sm font-medium text-slate-500">{fetchError}</p>
          <button
            onClick={fetchLogs}
            className="flex items-center gap-2 px-4 py-2 bg-navy-900 text-white rounded-lg text-sm font-medium hover:bg-navy-800 transition-colors"
          >
            <RefreshCw size={14} />
            Try Again
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-800 uppercase tracking-wider">Time</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-800 uppercase tracking-wider">User</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-800 uppercase tracking-wider">Action</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-800 uppercase tracking-wider">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.length > 0 ? (
                  pagedLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-sm text-slate-500 whitespace-nowrap">
                        {format(new Date(log.timestamp), 'MMM d, yyyy HH:mm:ss')}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-navy-900">
                        {log.username}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getActionBadgeColor(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {log.details}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center gap-2 text-slate-400">
                        <History size={32} className="opacity-40" />
                        <p className="text-base font-medium text-slate-500">No logs found</p>
                        <p className="text-sm">Try adjusting your search or filter</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-3 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between gap-4 flex-wrap">
            <p className="text-xs text-slate-500">
              {filteredLogs.length === 0 ? 'No logs' : (
                <>Showing <span className="font-semibold text-slate-700">{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredLogs.length)}</span> of <span className="font-semibold text-slate-700">{filteredLogs.length}</span> logs</>
              )}
            </p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
                {([50, 100, 200] as const).map(size => (
                  <button
                    key={size}
                    onClick={() => { setPageSize(size); setCurrentPage(1); }}
                    className={cn(
                      'px-3 py-1 text-xs font-semibold rounded-md transition-colors',
                      pageSize === size ? 'bg-navy-900 text-white' : 'text-slate-500 hover:text-navy-900 hover:bg-slate-100'
                    )}
                  >
                    {size}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded-lg bg-navy-900 text-white hover:bg-navy-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="px-3 py-1 text-xs font-semibold text-navy-900 min-w-[5rem] text-center">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1.5 rounded-lg bg-navy-900 text-white hover:bg-navy-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}