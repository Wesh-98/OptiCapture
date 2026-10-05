import { useState } from 'react';
import type { Category } from '../components/dashboard/types';

/**
 * Every category action below rewrites or deletes rows in bulk and cannot be undone,
 * so each one is armed first and only runs on a second, explicit confirmation.
 */
export type CategoryActionKind = 'activate' | 'deactivate' | 'deleteItems' | 'deleteCategory';

export interface PendingCategoryAction {
  id: number;
  action: CategoryActionKind;
}

export function useCategoryManagement(
  onStatsChange: () => void,
  addToast: (type: 'success' | 'error' | 'warning', message: string) => void
) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [showCatModal, setShowCatModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [catForm, setCatForm] = useState({ name: '', icon: '' });
  const [catError, setCatError] = useState('');
  const [catSaving, setCatSaving] = useState(false);
  const [pendingCategoryAction, setPendingCategoryAction] =
    useState<PendingCategoryAction | null>(null);

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
    if (!catForm.name.trim()) {
      setCatError('Category name is required');
      return;
    }
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
      if (!res.ok) {
        setCatError(data.error || 'Failed to save category');
        return;
      }
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
      const res = await fetch(`/api/categories/${catId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || 'Failed to delete category');
      }
      await fetchCategories();
      onStatsChange();
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to delete category');
    } finally {
      setPendingCategoryAction(null);
    }
  };

  const handleCategoryAction = async (
    categoryId: number,
    action: 'activate' | 'deactivate' | 'deleteItems'
  ) => {
    try {
      if (action === 'activate' || action === 'deactivate') {
        const res = await fetch(`/api/categories/${categoryId}/status`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: action === 'activate' ? 'Active' : 'Inactive' }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error || 'Failed to update category');
        }
      } else if (action === 'deleteItems') {
        const res = await fetch(`/api/categories/${categoryId}/items`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error || 'Failed to delete category items');
        }
      }
      await fetchCategories();
      onStatsChange();
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Category action failed');
    } finally {
      setPendingCategoryAction(null);
    }
  };

  return {
    categories,
    showCatModal,
    setShowCatModal,
    editingCategory,
    setEditingCategory,
    catForm,
    setCatForm,
    catError,
    setCatError,
    catSaving,
    pendingCategoryAction,
    setPendingCategoryAction,
    fetchCategories,
    openAddCat,
    openEditCat,
    handleSaveCategory,
    handleDeleteCategory,
    handleCategoryAction,
  };
}
