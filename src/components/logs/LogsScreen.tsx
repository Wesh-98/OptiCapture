import { LogsFilters } from './LogsFilters';
import { LogsTable } from './LogsTable';
import { useLogsPage } from '../../hooks/useLogsPage';

export function LogsScreen() {
  const logsPage = useLogsPage();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-navy-900">Activity Logs</h2>
        <p className="text-slate-500">Audit trail of all system actions</p>
      </div>

      <LogsFilters
        actionFilter={logsPage.actionFilter}
        dateFrom={logsPage.dateFrom}
        dateTo={logsPage.dateTo}
        filterOpen={logsPage.filterOpen}
        filterRef={logsPage.filterRef}
        logsCount={logsPage.logs.length}
        resultCount={logsPage.filteredLogs.length}
        search={logsPage.search}
        onClearActionFilter={logsPage.clearActionFilter}
        onClearDateRange={logsPage.clearDateRange}
        onDateFromChange={logsPage.setDateFrom}
        onDateToChange={logsPage.setDateTo}
        onSearchChange={logsPage.setSearch}
        onSelectActionFilter={logsPage.selectActionFilter}
        onToggleFilter={logsPage.toggleFilterOpen}
      />

      <LogsTable
        currentPage={logsPage.currentPage}
        fetchError={logsPage.fetchError}
        filteredLogs={logsPage.filteredLogs}
        isLoading={logsPage.isLoading}
        pageSize={logsPage.pageSize}
        pagedLogs={logsPage.pagedLogs}
        totalPages={logsPage.totalPages}
        onNextPage={logsPage.goToNextPage}
        onPageSizeChange={logsPage.setPageSize}
        onPreviousPage={logsPage.goToPreviousPage}
        onRetry={logsPage.refreshLogs}
      />
    </div>
  );
}
