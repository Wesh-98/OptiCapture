import { useState } from 'react';
import type { InventoryItem, ItemForm } from '../components/dashboard/types';
import { emptyForm } from '../components/dashboard/types';
import { readFileAsDataUrl } from '../lib/imageUpload';

export function useItemManagement(
  viewMode: 'categories' | 'items',
  selectedCategoryId: number | null,
  onStatsChange: () => void,
) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [formData, setFormData] = useState<ItemForm>({ ...emptyForm });
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editFormData, setEditFormData] = useState<ItemForm>({ ...emptyForm });
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<number | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<number | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv' | 'json' | 'pdf'>('xlsx');
  const [exporting, setExporting] = useState(false);

  const fetchItems = async (categoryId: number) => {
    const res = await fetch(`/api/inventory?category_id=${categoryId}`, { credentials: 'include' });
    if (res.ok) setItems(await res.json());
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.image || !formData.item_name || !formData.category_id) {
      alert('Please fill in all required fields (*)');
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
        setIsAddModalOpen(false);
        setFormData({ ...emptyForm });
        onStatsChange();
        if (viewMode === 'items' && selectedCategoryId) fetchItems(selectedCategoryId);
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to add item');
      }
    } catch (error) {
      console.error(error);
      alert('An error occurred');
    }
  };

  const handleEditItem = async (e: React.FormEvent) => {
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
        setEditingItem(null);
        onStatsChange();
        if (viewMode === 'items' && selectedCategoryId) fetchItems(selectedCategoryId);
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to update item');
      }
    } catch (error) {
      console.error(error);
      alert('An error occurred');
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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, target: 'add' | 'edit') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await readFileAsDataUrl(file);
    if (target === 'add') setFormData(prev => ({ ...prev, image: result }));
    else setEditFormData(prev => ({ ...prev, image: result }));
  };

  const handleDeleteItem = async (itemId: number) => {
    setDeletingItemId(itemId);
    try {
      await fetch(`/api/inventory/${itemId}`, { method: 'DELETE', credentials: 'include' });
      setItems(prev => prev.filter(i => i.id !== itemId));
      onStatsChange();
    } catch {} finally {
      setDeletingItemId(null);
      setConfirmDeleteItemId(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/inventory/export?format=${exportFormat}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inventory.${exportFormat}`;
      a.click();
      URL.revokeObjectURL(url);
      setShowExportModal(false);
    } catch {
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return {
    items,
    formData, setFormData,
    isAddModalOpen, setIsAddModalOpen,
    editingItem, setEditingItem,
    editFormData, setEditFormData,
    confirmDeleteItemId, setConfirmDeleteItemId,
    deletingItemId,
    showExportModal, setShowExportModal,
    exportFormat, setExportFormat,
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
