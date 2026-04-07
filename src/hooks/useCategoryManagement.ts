import { useState } from 'react';
import type { Category } from '../components/dashboard/types';

export function useCategoryManagement(onStatsChange: () => void) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [showCatModal, setShowCatModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [catForm, setCatForm] = useState({ name: '', icon: '' });
  const [catError, setCatError] = useState('');
  const [catSaving, setCatSaving] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<number | null>(null);

  const fetchCategories = async () => {
    const res = await fetch('/api/categories', { credentials: 'include' });
    if (res.ok) setCategories(await res.json());
  };

  const openAddCat = () => {
    setEditingCategory(null);
    setCatForm({ name: '', icon: '' });
    setCatError('');
    setShowCatModal(true);
  };

  const openEditCat = (cat: Category) => {
    setEditingCategory(cat);
    setCatForm({ name: cat.name, icon: cat.icon || '' });
    setCatError('');
    setShowCatModal(true);
  };

  const handleSaveCategory = async () => {
    if (!catForm.name.trim()) { setCatError('Category name is required'); return; }
    setCatError('');
    setCatSaving(true);
    try {
      const url = editingCategory ? `/api/categories/${editingCategory.id}` : '/api/categories';
      const method = editingCategory ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: catForm.name.trim(), icon: catForm.icon || 'Package' }),
      });
      const data = await res.json();
      if (!res.ok) { setCatError(data.error || 'Failed to save category'); return; }
      setShowCatModal(false);
      setEditingCategory(null);
      setCatForm({ name: '', icon: '' });
      fetchCategories();
    } catch {
      setCatError('Failed to save category');
    } finally {
      setCatSaving(false);
    }
  };

  const handleDeleteCategory = async (catId: number) => {
    try {
      await fetch(`/api/categories/${catId}`, { method: 'DELETE', credentials: 'include' });
      setDeletingCategoryId(null);
      fetchCategories();
      onStatsChange();
    } catch {}
  };

  const handleCategoryAction = async (categoryId: number, action: 'activate' | 'deactivate' | 'deleteItems') => {
    try {
      if (action === 'activate' || action === 'deactivate') {
        await fetch(`/api/categories/${categoryId}/status`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: action === 'activate' ? 'Active' : 'Inactive' }),
        });
      } else if (action === 'deleteItems') {
        await fetch(`/api/categories/${categoryId}/items`, {
          method: 'DELETE',
          credentials: 'include',
        });
      }
      fetchCategories();
      onStatsChange();
    } catch {}
  };

  return {
    categories,
    showCatModal, setShowCatModal,
    editingCategory, setEditingCategory,
    catForm, setCatForm,
    catError, setCatError,
    catSaving,
    deletingCategoryId, setDeletingCategoryId,
    fetchCategories,
    openAddCat, openEditCat,
    handleSaveCategory,
    handleDeleteCategory,
    handleCategoryAction,
  };
}
