import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { Search, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useDashboardStats } from '../hooks/useDashboardStats';
import { useActiveSessions } from '../hooks/useActiveSessions';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { useCategoryManagement } from '../hooks/useCategoryManagement';
import { useItemManagement } from '../hooks/useItemManagement';
import { StatsHeader } from '../components/dashboard/StatsHeader';
import { SessionsSection } from '../components/dashboard/SessionsSection';
import { DashboardToolbar } from '../components/dashboard/DashboardToolbar';
import { SearchResultsTable } from '../components/dashboard/SearchResultsTable';
import { CategoriesTable } from '../components/dashboard/CategoriesTable';
import { ItemsTable } from '../components/dashboard/ItemsTable';
import { AddItemModal } from '../components/dashboard/AddItemModal';
import { EditItemModal } from '../components/dashboard/EditItemModal';
import { CategoryModal } from '../components/dashboard/CategoryModal';
import { ExportModal } from '../components/dashboard/ExportModal';
import { emptyForm } from '../components/dashboard/types';
import type { Category } from '../components/dashboard/types';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isOwner = user?.role !== 'taker';
  const prefersReducedMotion = useReducedMotion();

  const [viewMode, setViewMode] = useState<'categories' | 'items'>('categories');
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [search, setSearch] = useState('');
  const [activeActionMenu, setActiveActionMenu] = useState<number | null>(null);

  // Pagination
  const [pageSize, setPageSize] = useState<50 | 100 | 200>(50);
  const [currentPage, setCurrentPage] = useState(1);

  const { stats, fetchStats } = useDashboardStats();
  const { activeSessions, sessionsOpen, setSessionsOpen, fetchActiveSessions, deleteSession } = useActiveSessions();
  const { globalSearch, setGlobalSearch, searchResults, isSearching } = useGlobalSearch();

  const cats = useCategoryManagement(fetchStats);

  const items = useItemManagement(viewMode, selectedCategory?.id ?? null, fetchStats);

  // Initial fetch
  useEffect(() => {
    fetchStats();
    cats.fetchCategories();
    fetchActiveSessions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch items when view/category changes
  useEffect(() => {
    if (viewMode === 'items' && selectedCategory) {
      items.fetchItems(selectedCategory.id);
      setCurrentPage(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedCategory]);

  // Reset pagination on search change
  useEffect(() => { setCurrentPage(1); }, [search]);

  const handleViewItems = (cat: Category) => {
    setSelectedCategory(cat);
    setViewMode('items');
    items.fetchItems(cat.id);
    setActiveActionMenu(null);
  };

  const handleBack = () => {
    setViewMode('categories');
    setSearch('');
  };

  const handleOpenAddItem = () => {
    items.setFormData({ ...emptyForm, category_id: viewMode === 'items' ? String(selectedCategory?.id ?? '') : '' });
    items.setIsAddModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <StatsHeader stats={stats} isOwner={isOwner} onExportClick={() => items.setShowExportModal(true)} />

      <SessionsSection
        sessions={activeSessions}
        isOpen={sessionsOpen}
        onToggle={() => setSessionsOpen(o => !o)}
        onDelete={deleteSession}
        onNewScan={() => navigate('/scan')}
      />

      {/* Global Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          type="text"
          value={globalSearch}
          onChange={e => setGlobalSearch(e.target.value)}
          placeholder="Search all inventory by name, UPC, or category..."
          className="w-full pl-9 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-700 shadow-sm"
        />
        {globalSearch && (
          <button onClick={() => setGlobalSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Main Content */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden min-h-[500px]">
        <DashboardToolbar
          viewMode={viewMode}
          selectedCategory={selectedCategory}
          isOwner={isOwner}
          search={search}
          onSearchChange={setSearch}
          onBack={handleBack}
          onAddCategory={cats.openAddCat}
          onAddItem={handleOpenAddItem}
        />

        {globalSearch.trim() ? (
          <SearchResultsTable
            results={searchResults}
            isSearching={isSearching}
            globalSearch={globalSearch}
            isOwner={isOwner}
            confirmDeleteItemId={items.confirmDeleteItemId}
            deletingItemId={items.deletingItemId}
            onEdit={items.openEditModal}
            onConfirmDelete={items.setConfirmDeleteItemId}
            onDelete={items.handleDeleteItem}
          />
        ) : viewMode === 'categories' ? (
          <CategoriesTable
            categories={cats.categories}
            search={search}
            isOwner={isOwner}
            activeActionMenu={activeActionMenu}
            setActiveActionMenu={setActiveActionMenu}
            deletingCategoryId={cats.deletingCategoryId}
            setDeletingCategoryId={cats.setDeletingCategoryId}
            onViewItems={handleViewItems}
            onEditCategory={cats.openEditCat}
            onCategoryAction={cats.handleCategoryAction}
            onDeleteCategory={cats.handleDeleteCategory}
          />
        ) : (
          <ItemsTable
            items={items.items}
            search={search}
            isOwner={isOwner}
            pageSize={pageSize}
            currentPage={currentPage}
            confirmDeleteItemId={items.confirmDeleteItemId}
            deletingItemId={items.deletingItemId}
            onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1); }}
            onPageChange={setCurrentPage}
            onConfirmDelete={items.setConfirmDeleteItemId}
            onDelete={items.handleDeleteItem}
            onEdit={items.openEditModal}
          />
        )}
      </div>

      <AddItemModal
        isOpen={items.isAddModalOpen}
        formData={items.formData}
        categories={cats.categories}
        prefersReducedMotion={prefersReducedMotion}
        onChange={items.setFormData}
        onImageChange={(e) => items.handleImageUpload(e, 'add')}
        onSubmit={items.handleAddItem}
        onClose={() => items.setIsAddModalOpen(false)}
      />

      <EditItemModal
        editingItem={items.editingItem}
        editFormData={items.editFormData}
        categories={cats.categories}
        prefersReducedMotion={prefersReducedMotion}
        onChange={items.setEditFormData}
        onImageChange={(e) => items.handleImageUpload(e, 'edit')}
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
        onClose={() => { cats.setShowCatModal(false); cats.setEditingCategory(null); }}
      />

      <ExportModal
        isOpen={items.showExportModal}
        exportFormat={items.exportFormat}
        exporting={items.exporting}
        onFormatChange={items.setExportFormat}
        onExport={items.handleExport}
        onClose={() => items.setShowExportModal(false)}
      />
    </div>
  );
}
