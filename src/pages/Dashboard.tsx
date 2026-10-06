import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useDashboardStats } from '../hooks/useDashboardStats';
import { useActiveSessions } from '../hooks/useActiveSessions';
import { useCategoryManagement } from '../hooks/useCategoryManagement';
import { useItemManagement } from '../hooks/useItemManagement';
import { useToast } from '../hooks/useToast';
import { StatsHeader } from '../components/dashboard/StatsHeader';
import { SessionsSection } from '../components/dashboard/SessionsSection';
import { DashboardToolbar } from '../components/dashboard/DashboardToolbar';
import { CategoriesTable } from '../components/dashboard/CategoriesTable';
import { ItemsTable } from '../components/dashboard/ItemsTable';
import { AddItemModal } from '../components/dashboard/AddItemModal';
import { EditItemModal } from '../components/dashboard/EditItemModal';
import { CategoryModal } from '../components/dashboard/CategoryModal';
import { ExportModal } from '../components/dashboard/ExportModal';
import { ToastContainer } from '../components/scan/ToastContainer';
import { emptyForm } from '../components/dashboard/types';
import type { Category } from '../components/dashboard/types';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isOwner = user?.role === 'owner' || user?.role === 'superadmin';
  const canEditItems = isOwner || user?.role === 'taker';
  const prefersReducedMotion = useReducedMotion();

  const [viewMode, setViewMode] = useState<'categories' | 'items'>('categories');
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'Active' | 'Inactive'>('');
  const [activeActionMenu, setActiveActionMenu] = useState<number | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set());
  const [selectingAll, setSelectingAll] = useState(false);

  // Pagination
  const [pageSize, setPageSize] = useState<50 | 100 | 200>(50);
  const [currentPage, setCurrentPage] = useState(1);

  const { toasts, addToast } = useToast();
  const { stats, fetchStats } = useDashboardStats();
  const { activeSessions, sessionsOpen, setSessionsOpen, fetchActiveSessions, deleteSession } =
    useActiveSessions();
  const refreshVisibleStats = () =>
    fetchStats(viewMode === 'items' ? (selectedCategory?.id ?? null) : null);
  const cats = useCategoryManagement(refreshVisibleStats, addToast);

  const items = useItemManagement(
    viewMode,
    selectedCategory?.id ?? null,
    statusFilter,
    refreshVisibleStats,
    addToast
  );
  const { setShowExportModal } = items;

  useEffect(() => {
    if (isOwner && searchParams.get('export') === '1') {
      setShowExportModal(true);
    }
  }, [isOwner, searchParams, setShowExportModal]);

  // Initial fetch
  useEffect(() => {
    void cats.fetchCategories();
    void fetchActiveSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch items when view/category changes
  useEffect(() => {
    if (viewMode === 'items') {
      setCurrentPage(1);
      void items.fetchItems(selectedCategory?.id ?? null, 1, pageSize);
      void fetchStats(selectedCategory?.id ?? null);
    } else {
      void fetchStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedCategory, statusFilter]);

  // Reset pagination on search change
  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  const handleViewItems = (cat: Category) => {
    setSelectedCategory(cat);
    setViewMode('items');
    setSearch('');
    setCurrentPage(1);
    setSelectedItemIds(new Set());
    void items.fetchItems(cat.id, 1, pageSize);
    setActiveActionMenu(null);
  };

  const handleBack = () => {
    setViewMode('categories');
    setSelectedCategory(null);
    setSearch('');
    setSelectedItemIds(new Set());
  };

  const handleStatusFilterChange = (status: '' | 'Active' | 'Inactive') => {
    setStatusFilter(status);
    setCurrentPage(1);
  };

  const handleToggleItem = (itemId: number) => {
    setSelectedItemIds(current => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleToggleSelectAll = async () => {
    if (!selectedCategory) return;
    if (stats.totalItems > 0 && selectedItemIds.size === stats.totalItems) {
      setSelectedItemIds(new Set());
      return;
    }

    setSelectingAll(true);
    try {
      const res = await fetch(`/api/inventory/ids?category_id=${selectedCategory.id}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to select category items');
      const data = (await res.json()) as { ids?: number[] };
      setSelectedItemIds(new Set(data.ids ?? []));
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to select category items');
    } finally {
      setSelectingAll(false);
    }
  };

  const handleOpenAddItem = () => {
    items.setFormData({
      ...emptyForm,
      category_id: viewMode === 'items' ? String(selectedCategory?.id ?? '') : '',
    });
    items.setIsAddModalOpen(true);
  };

  const handleCloseExportModal = () => {
    items.setShowExportModal(false);
    if (searchParams.has('export')) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('export');
      setSearchParams(nextParams, { replace: true });
    }
  };

  const handleExport = async () => {
    const didExport = await items.handleExport();
    if (didExport) {
      handleCloseExportModal();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-black">Inventory Portal</h1>
          <p className="mt-1 text-sm font-medium text-theme-muted">Inventory Summary</p>
        </div>

        {viewMode === 'categories' && isOwner && (
          <div className="flex items-center gap-2">
            <button
              onClick={cats.openAddCat}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
            >
              <Plus size={15} />
              Add Category
            </button>
            <button
              onClick={handleOpenAddItem}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-600"
            >
              <Plus size={15} />
              Add New Item
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <StatsHeader stats={stats} showTotalCategories={viewMode === 'categories'} />
        </div>
        {viewMode === 'items' && canEditItems && (
          <button
            onClick={handleOpenAddItem}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 self-end whitespace-nowrap rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-600 lg:self-auto"
          >
            <Plus size={16} />
            Add New Item
          </button>
        )}
      </div>

      <SessionsSection
        sessions={activeSessions}
        isOpen={sessionsOpen}
        now={Date.now()}
        onToggle={() => setSessionsOpen(o => !o)}
        onDelete={deleteSession}
        onNewScan={() => navigate('/scan')}
      />

      {/* Main Content */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden min-h-[500px]">
        <DashboardToolbar
          viewMode={viewMode}
          selectedCategory={selectedCategory}
          search={search}
          statusFilter={statusFilter}
          onSearchChange={setSearch}
          onStatusFilterChange={handleStatusFilterChange}
          onBack={handleBack}
        />

        {viewMode === 'categories' ? (
          <CategoriesTable
            categories={cats.categories}
            search={search}
            statusFilter={statusFilter}
            isOwner={isOwner}
            activeActionMenu={activeActionMenu}
            setActiveActionMenu={setActiveActionMenu}
            pendingCategoryAction={cats.pendingCategoryAction}
            setPendingCategoryAction={cats.setPendingCategoryAction}
            onViewItems={handleViewItems}
            onEditCategory={cats.openEditCat}
            onCategoryAction={cats.handleCategoryAction}
            onDeleteCategory={cats.handleDeleteCategory}
          />
        ) : (
          <ItemsTable
            items={items.items}
            total={items.totalItems}
            search={search}
            canEditItems={canEditItems}
            pageSize={pageSize}
            currentPage={currentPage}
            confirmDeleteItemId={items.confirmDeleteItemId}
            deletingItemId={items.deletingItemId}
            selectedItemIds={selectedItemIds}
            selectingAll={selectingAll}
            onPageSizeChange={size => {
              setPageSize(size);
              setCurrentPage(1);
              void items.fetchItems(selectedCategory?.id ?? null, 1, size, statusFilter);
            }}
            onPageChange={page => {
              setCurrentPage(page);
              void items.fetchItems(selectedCategory?.id ?? null, page, pageSize, statusFilter);
            }}
            onConfirmDelete={items.setConfirmDeleteItemId}
            onDelete={itemId => {
              setSelectedItemIds(current => {
                const next = new Set(current);
                next.delete(itemId);
                return next;
              });
              void items.handleDeleteItem(itemId);
            }}
            onEdit={items.openEditModal}
            onToggleItem={handleToggleItem}
            onToggleSelectAll={() => void handleToggleSelectAll()}
          />
        )}
      </div>

      <AddItemModal
        isOpen={items.isAddModalOpen}
        formData={items.formData}
        categories={cats.categories}
        prefersReducedMotion={prefersReducedMotion}
        onChange={items.setFormData}
        onImageChange={e => items.handleImageUpload(e, 'add')}
        onSubmit={items.handleAddItem}
        onClose={() => items.setIsAddModalOpen(false)}
      />

      <EditItemModal
        editingItem={items.editingItem}
        editFormData={items.editFormData}
        categories={cats.categories}
        prefersReducedMotion={prefersReducedMotion}
        onChange={items.setEditFormData}
        onImageChange={e => items.handleImageUpload(e, 'edit')}
        onSubmit={items.handleEditItem}
        onClose={() => items.setEditingItem(null)}
      />

      <CategoryModal
        isOpen={cats.showCatModal}
        editingCategory={cats.editingCategory}
        catForm={cats.catForm}
        catError={cats.catError}
        catSaving={cats.catSaving}
        onChange={cats.setCatForm}
        onSave={cats.handleSaveCategory}
        onClose={() => {
          cats.setShowCatModal(false);
          cats.setEditingCategory(null);
        }}
      />

      <ExportModal
        isOpen={items.showExportModal}
        exportFormat={items.exportFormat}
        exporting={items.exporting}
        onFormatChange={items.setExportFormat}
        onExport={handleExport}
        onClose={handleCloseExportModal}
      />

      <ToastContainer toasts={toasts} prefersReducedMotion={prefersReducedMotion} />
    </div>
  );
}
