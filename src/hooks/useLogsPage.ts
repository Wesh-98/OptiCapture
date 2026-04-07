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

  const filterRef = useRef<HTMLDivElement>(null);

  const refreshLogs = useCallback(async () => {
    setIsLoading(true);
    setFetchError('');

    try {
      const activityLogs = await fetchActivityLogs();
      setLogs(activityLogs);
    } catch (error) {
      setFetchError(
        error instanceof Error
          ? error.message
          : 'Could not load activity logs. Check your connection and try again.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshLogs();
  }, [refreshLogs]);

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

  const filteredLogs = useMemo(() => {
    let nextLogs = logs;

    if (actionFilter !== 'All') {
      nextLogs = nextLogs.filter(log => log.action === actionFilter);
    }

    const trimmedSearch = search.trim().toLowerCase();
    if (trimmedSearch) {
      nextLogs = nextLogs.filter(log => {
        const details = log.details.toLowerCase();
        const username = log.username.toLowerCase();
        return details.includes(trimmedSearch) || username.includes(trimmedSearch);
      });
    }

    if (dateFrom) {
      const from = new Date(dateFrom);
      nextLogs = nextLogs.filter(log => new Date(log.timestamp) >= from);
    }

    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      nextLogs = nextLogs.filter(log => new Date(log.timestamp) <= to);
    }

    return nextLogs;
  }, [logs, actionFilter, search, dateFrom, dateTo]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredLogs.length / pageSize)),
    [filteredLogs.length, pageSize]
  );

  useEffect(() => {
    setCurrentPage(prev => Math.min(prev, totalPages));
  }, [totalPages]);

  const pagedLogs = useMemo(
    () => filteredLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredLogs, currentPage, pageSize]
  );

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
