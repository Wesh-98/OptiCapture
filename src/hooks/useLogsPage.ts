import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchActivityLogs } from '../components/logs/logsApi';
import {
  PAGE_SIZE_OPTIONS,
  type LogActionFilter,
  type LogEntry,
  type LogsPageSize,
} from '../components/logs/types';

export function useLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [actionFilter, setActionFilter] = useState<LogActionFilter>('All');
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [pageSize, setPageSize] = useState<LogsPageSize>(PAGE_SIZE_OPTIONS[0]);
  const [currentPage, setCurrentPage] = useState(1);
  const [fetchError, setFetchError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [resultCount, setResultCount] = useState(0);
  const [logsCount, setLogsCount] = useState(0);

  const filterRef = useRef<HTMLDivElement>(null);

  const refreshLogs = useCallback(async () => {
    setIsLoading(true);
    setFetchError('');

    try {
      const page = await fetchActivityLogs({
        action: actionFilter === 'All' ? undefined : actionFilter,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        q: search.trim() || undefined,
        page: currentPage,
        limit: pageSize,
      });
      setLogs(page.items);
      setResultCount(page.total);
      setLogsCount(page.storeTotal);
    } catch (error) {
      setFetchError(
        error instanceof Error
          ? error.message
          : 'Could not load activity logs. Check your connection and try again.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [actionFilter, currentPage, dateFrom, dateTo, pageSize, search]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => void refreshLogs(), search.trim() ? 300 : 0);
    return () => globalThis.clearTimeout(timer);
  }, [refreshLogs, search]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    };

    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [actionFilter, search, dateFrom, dateTo, pageSize]);

  const filteredLogs = logs;

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(resultCount / pageSize)),
    [resultCount, pageSize]
  );

  useEffect(() => {
    setCurrentPage(prev => Math.min(prev, totalPages));
  }, [totalPages]);

  const pagedLogs = filteredLogs;

  const clearDateRange = useCallback(() => {
    setDateFrom('');
    setDateTo('');
  }, []);

  const toggleFilterOpen = useCallback(() => {
    setFilterOpen(prev => !prev);
  }, []);

  const selectActionFilter = useCallback((nextFilter: LogActionFilter) => {
    setActionFilter(nextFilter);
    setFilterOpen(false);
  }, []);

  const goToPreviousPage = useCallback(() => {
    setCurrentPage(prev => Math.max(1, prev - 1));
  }, []);

  const goToNextPage = useCallback(() => {
    setCurrentPage(prev => Math.min(totalPages, prev + 1));
  }, [totalPages]);

  return {
    logs,
    logsCount,
    resultCount,
    actionFilter,
    search,
    filterOpen,
    pageSize,
    currentPage,
    fetchError,
    isLoading,
    dateFrom,
    dateTo,
    filterRef,
    filteredLogs,
    totalPages,
    pagedLogs,
    setSearch,
    setDateFrom,
    setDateTo,
    setPageSize,
    clearDateRange,
    toggleFilterOpen,
    selectActionFilter,
    clearActionFilter: () => setActionFilter('All' as const),
    goToPreviousPage,
    goToNextPage,
    refreshLogs,
  };
}
