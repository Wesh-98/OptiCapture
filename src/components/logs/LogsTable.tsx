import { format } from 'date-fns';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  History,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { LOG_ACTION_META, PAGE_SIZE_OPTIONS, type LogEntry, type LogsPageSize } from './types';

interface LogsTableProps {
  currentPage: number;
  fetchError: string;
  filteredLogs: readonly LogEntry[];
  isLoading: boolean;
  pageSize: LogsPageSize;
  pagedLogs: readonly LogEntry[];
  totalPages: number;
  onNextPage: () => void;
  onPageSizeChange: (value: LogsPageSize) => void;
  onPreviousPage: () => void;
  onRetry: () => void;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : format(date, 'MMM d, yyyy HH:mm:ss');
}

export function LogsTable({
  currentPage,
  fetchError,
  filteredLogs,
  isLoading,
  pageSize,
  pagedLogs,
  totalPages,
  onNextPage,
  onPageSizeChange,
  onPreviousPage,
  onRetry,
}: LogsTableProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
        <Loader2 size={20} className="animate-spin" />
        <span className="text-sm">Loading logs...</span>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
        <AlertTriangle size={32} className="text-red-400 opacity-70" />
        <p className="text-sm font-medium text-slate-500">{fetchError}</p>
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 bg-navy-900 text-white rounded-lg text-sm font-medium hover:bg-navy-800 transition-colors"
        >
          <RefreshCw size={14} />
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 text-xs font-semibold text-slate-800 uppercase tracking-wider">
                Time
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-800 uppercase tracking-wider">
                User
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-800 uppercase tracking-wider">
                Action
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-800 uppercase tracking-wider">
                Details
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredLogs.length > 0 ? (
              pagedLogs.map(log => {
                const badgeClassName =
                  log.action in LOG_ACTION_META
                    ? LOG_ACTION_META[log.action as keyof typeof LOG_ACTION_META].badgeClassName
                    : 'bg-slate-100 text-slate-600';

                return (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-slate-500 whitespace-nowrap">
                      {formatTimestamp(log.timestamp)}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-navy-900">{log.username}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${badgeClassName}`}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">{log.details}</td>
                  </tr>
                );
              })
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
          {filteredLogs.length === 0 ? (
            'No logs'
          ) : (
            <>
              Showing{' '}
              <span className="font-semibold text-slate-700">
                {(currentPage - 1) * pageSize + 1}-
                {Math.min(currentPage * pageSize, filteredLogs.length)}
              </span>{' '}
              of <span className="font-semibold text-slate-700">{filteredLogs.length}</span> logs
            </>
          )}
        </p>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
            {PAGE_SIZE_OPTIONS.map(size => (
              <button
                key={size}
                type="button"
                onClick={() => onPageSizeChange(size)}
                className={cn(
                  'px-3 py-1 text-xs font-semibold rounded-md transition-colors',
                  pageSize === size
                    ? 'bg-navy-900 text-white'
                    : 'text-slate-500 hover:text-navy-900 hover:bg-slate-100'
                )}
              >
                {size}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPreviousPage}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg bg-navy-900 text-white hover:bg-navy-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-3 py-1 text-xs font-semibold text-navy-900 min-w-[5rem] text-center">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={onNextPage}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg bg-navy-900 text-white hover:bg-navy-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
