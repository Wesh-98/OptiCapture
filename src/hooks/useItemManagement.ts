import { useRef, useState } from 'react';
import type { CategoryStatusFilter, InventoryItem, ItemForm } from '../components/dashboard/types';
import { emptyForm } from '../components/dashboard/types';
import { readFileAsDataUrl } from '../lib/imageUpload';

export function useItemManagement(
  viewMode: 'categories' | 'items',
  selectedCategoryId: number | null,
  selectedStatus: CategoryStatusFilter,
  onStatsChange: () => void,
  addToast: (type: 'success' | 'error' | 'warning', message: string) => void,
  /** Searches items on the server; in the categories view a query lists matches store-wide. */
  itemQuery = ''
) {
  // The item list shows when a category is open, or as search results over the categories.
  const listShown = viewMode === 'items' || itemQuery !== '';
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [formData, setFormData] = useState<ItemForm>({ ...emptyForm });
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editFormData, setEditFormData] = useState<ItemForm>({ ...emptyForm });
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<number | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<number | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv' | 'json' | 'pdf'>('xlsx');
  const [exporting, setExporting] = useState(false);
  // Numbers each list request; typing fires several, and only the latest may fill the list.
  const latestFetchRef = useRef(0);

  const fetchItems = async (
    categoryId: number | null,
    page = 1,
    limit = 50,
    status = selectedStatus,
    q = itemQuery
  ) => {
    const request = ++latestFetchRef.current;
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });

    if (categoryId !== null) {
      params.set('category_id', String(categoryId));
    }

    if (status) {
      params.set('status', status);
    }

    if (q) {
      params.set('q', q);
    }

    const res = await fetch(`/api/inventory?${params.toString()}`, { credentials: 'include' });
    if (request !== latestFetchRef.current || !res.ok) return;
    const data = await res.json();
    if (request === latestFetchRef.current) {
      setItems(data.items ?? []);
      setTotalItems(data.total ?? 0);
    }
  };

  const handleAddItem = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    const missing = [
      !formData.item_name.trim() && 'a name',
      !formData.upc.trim() && 'a UPC',
      !formData.category_id && 'a category',
    ].filter(Boolean);
    if (missing.length > 0) {
      addToast('warning', `Please add ${missing.join(', ')} before saving.`);
      return;
    }
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        addToast('success', `Added "${formData.item_name.trim()}"`);
        setIsAddModalOpen(false);
        setFormData({ ...emptyForm });
        onStatsChange();
        if (listShown) void fetchItems(selectedCategoryId);
      } else {
        const err = await res.json();
        addToast('error', err.error || 'Failed to add item');
      }
    } catch (error) {
      console.error(error);
      addToast('error', 'An error occurred');
    }
  };

  const handleEditItem = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!editingItem) return;
    try {
      const res = await fetch(`/api/inventory/${editingItem.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editFormData),
      });
      if (res.ok) {
        addToast('success', `Saved changes to "${editFormData.item_name.trim()}"`);
        setEditingItem(null);
        onStatsChange();
        if (listShown) void fetchItems(selectedCategoryId);
      } else {
        const err = await res.json();
        addToast('error', err.error || 'Failed to update item');
      }
    } catch (error) {
      console.error(error);
      addToast('error', 'An error occurred');
    }
  };

  const openEditModal = (item: InventoryItem) => {
    setEditingItem(item);
    setEditFormData({
      image: item.image ?? '',
      item_name: item.item_name ?? '',
      upc: item.upc ?? '',
      unit: item.unit ?? '',
      quantity: item.quantity ?? 0,
      category_id: String(item.category_id ?? ''),
      status: item.status ?? 'Active',
      sale_price: item.sale_price ?? 0,
      tax_percent: item.tax_percent ?? 0,
      description: item.description ?? '',
      tag_names: item.tag_names ?? '',
    });
  };

  const handleImageUpload = async (
    e: { target: { files: FileList | null } },
    target: 'add' | 'edit'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await readFileAsDataUrl(file);
    if (target === 'add') setFormData(prev => ({ ...prev, image: result }));
    else setEditFormData(prev => ({ ...prev, image: result }));
  };

  const handleDeleteItem = async (itemId: number) => {
    setDeletingItemId(itemId);
    try {
      const res = await fetch(`/api/inventory/${itemId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || 'Failed to delete item');
      }
      const name = items.find(i => i.id === itemId)?.item_name;
      addToast('success', name ? `Deleted "${name}"` : 'Item deleted');
      setItems(prev => prev.filter(i => i.id !== itemId));
      onStatsChange();
      if (listShown) void fetchItems(selectedCategoryId);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to delete item');
    } finally {
      setDeletingItemId(null);
      setConfirmDeleteItemId(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/inventory/export?format=${exportFormat}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inventory.${exportFormat}`;
      a.click();
      URL.revokeObjectURL(url);
      addToast('success', `Exported inventory as ${exportFormat.toUpperCase()}`);
      setShowExportModal(false);
      return true;
    } catch {
      addToast('error', 'Export failed. Please try again.');
      return false;
    } finally {
      setExporting(false);
    }
  };

  return {
    items,
    totalItems,
    formData,
    setFormData,
    isAddModalOpen,
    setIsAddModalOpen,
    editingItem,
    setEditingItem,
    editFormData,
    setEditFormData,
    confirmDeleteItemId,
    setConfirmDeleteItemId,
    deletingItemId,
    showExportModal,
    setShowExportModal,
    exportFormat,
    setExportFormat,
    exporting,
    fetchItems,
    handleAddItem,
    handleEditItem,
    openEditModal,
    handleImageUpload,
    handleDeleteItem,
    handleExport,
  };
}
