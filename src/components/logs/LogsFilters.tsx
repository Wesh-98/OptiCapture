import type { RefObject } from 'react';
import { ChevronDown, Filter, Search, X } from 'lucide-react';
import { LOG_ACTIONS, LOG_ACTION_META, type LogActionFilter } from './types';

interface LogsFiltersProps {
  actionFilter: LogActionFilter;
  dateFrom: string;
  dateTo: string;
  filterOpen: boolean;
  filterRef: RefObject<HTMLDivElement | null>;
  logsCount: number;
  resultCount: number;
  search: string;
  onClearActionFilter: () => void;
  onClearDateRange: () => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSelectActionFilter: (value: LogActionFilter) => void;
  onToggleFilter: () => void;
}

export function LogsFilters({
  actionFilter,
  dateFrom,
  dateTo,
  filterOpen,
  filterRef,
  logsCount,
  resultCount,
  search,
  onClearActionFilter,
  onClearDateRange,
  onDateFromChange,
  onDateToChange,
  onSearchChange,
  onSelectActionFilter,
  onToggleFilter,
}: LogsFiltersProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="Search by username or details..."
            value={search}
            onChange={event => onSearchChange(event.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg leading-5 bg-white placeholder-slate-500 focus:outline-none focus:placeholder-slate-400 focus:ring-1 focus:ring-navy-900 focus:border-navy-900"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={event => onDateFromChange(event.target.value)}
            className="px-2 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-navy-900 focus:border-navy-900 text-slate-700"
            title="From date"
          />
          <span className="text-slate-400 text-xs">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={event => onDateToChange(event.target.value)}
            min={dateFrom || undefined}
            className="px-2 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-navy-900 focus:border-navy-900 text-slate-700"
            title="To date"
          />
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={onClearDateRange}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              title="Clear dates"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="relative" ref={filterRef}>
          <button
            type="button"
            onClick={onToggleFilter}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white hover:bg-slate-50 transition-colors"
          >
            <Filter size={15} className="text-slate-500" />
            <span className="text-slate-700 font-medium">
              {actionFilter === 'All' ? 'Filter' : actionFilter}
            </span>
            <ChevronDown size={14} className="text-slate-400" />
          </button>

          {filterOpen && (
            <div className="absolute right-0 mt-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200 z-20 py-1">
              {LOG_ACTIONS.map((action, index) => {
                const metadata = LOG_ACTION_META[action];
                const Icon = metadata.icon;

                return (
                  <div key={action}>
                    <button
                      type="button"
                      onClick={() => onSelectActionFilter(action)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50 transition-colors ${
                        actionFilter === action ? 'text-navy-900 font-semibold' : 'text-slate-700'
                      }`}
                    >
                      <Icon size={15} className="text-slate-500 shrink-0" />
                      <span className="flex-1 text-left">{action}</span>
                      {action !== 'All' && (
                        <span className={`w-2 h-2 rounded-full ${metadata.dotClassName}`} />
                      )}
                    </button>
                    {index === 0 && <div className="border-t border-slate-100 my-1" />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-slate-500">
        Showing {resultCount} of {logsCount} logs
        {actionFilter !== 'All' && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-navy-900 text-white text-xs font-medium">
            {actionFilter}
            <button type="button" onClick={onClearActionFilter} className="hover:opacity-80">
              <X size={10} />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
