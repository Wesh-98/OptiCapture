import { useState } from 'react';
import type { SessionItem, Category, UiStatus } from '../components/scan/types';

export function useCommitModal(
  sessionId: string | null,
  items: SessionItem[],
  selectedIds: Set<number>,
  isBusyRef: React.MutableRefObject<boolean>,
  lastPollAtRef: React.MutableRefObject<number | null>,
  setItems: (updater: (prev: SessionItem[]) => SessionItem[]) => void,
  setSelectedIds: (ids: Set<number>) => void,
  setUiStatus: (s: UiStatus) => void,
  setStatusMessage: (m: string) => void,
  addToast: (type: 'success' | 'error' | 'warning', message: string) => void,
) {
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [itemCategories, setItemCategories] = useState<Map<number, number>>(new Map());
  const [modalSelectedIds, setModalSelectedIds] = useState<Set<number>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState<number | null>(null);

  const fetchCategories = async (): Promise<Category[]> => {
    setCategoriesLoading(true);
    try {
      const res = await fetch('/api/categories', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch categories');
      const data: Category[] = await res.json();
      const active = data.filter(c => c.status !== 'Inactive');
      setCategories(active);
      return active;
    } catch {
      addToast('error', 'Failed to load categories');
      return [];
    } finally {
      setCategoriesLoading(false);
    }
  };

  const openCommitModal = async () => {
    if (!sessionId || selectedIds.size === 0 || isBusyRef.current) return;
    const activeCategories = await fetchCategories();
    if (activeCategories.length === 0) {
      addToast('error', 'No active categories found. Create a category before committing.');
      return;
    }
    setItemCategories(new Map());
    setModalSelectedIds(new Set());
    setBulkCategoryId(null);
    setShowCommitModal(true);
  };

  const confirmCommit = async () => {
    if (!sessionId || isBusyRef.current) return;
    const assignments = [...selectedIds]
      .filter(id => itemCategories.has(id))
      .map(id => ({ id, category_id: itemCategories.get(id)! }));
    if (assignments.length === 0) return;
    setShowCommitModal(false);
    isBusyRef.current = true;
    setUiStatus('committing');
    setStatusMessage('Committing selected items to inventory...');
    try {
      const res = await fetch(`/api/session/${sessionId}/commit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      });
      if (!res.ok) throw new Error(`Commit failed: ${res.status}`);
      const result = await res.json();
      const skipped = (result.skippedExisting ?? 0) + (result.skippedUnknown ?? 0);
      let toastMsg: string;
      if (skipped > 0) {
        const dupSuffix = result.skippedExisting !== 1 ? 's' : '';
        toastMsg = `${result.inserted ?? 0} committed — ${result.skippedExisting ?? 0} duplicate${dupSuffix}, ${result.skippedUnknown ?? 0} unknown skipped`;
      } else {
        toastMsg = `${result.inserted ?? 0} item(s) committed to inventory`;
      }
      addToast(result.inserted > 0 ? 'success' : 'warning', toastMsg);
      const committedIds = new Set(assignments.map(a => a.id));
      setItems(prev => prev.filter(item => !committedIds.has(item.id)));
      setSelectedIds(new Set());
      setItemCategories(new Map());
      lastPollAtRef.current = null;
      isBusyRef.current = false;
      setUiStatus('ready');
      setStatusMessage('Session ready. Scan the QR code with your phone.');
    } catch {
      setUiStatus('error');
      setStatusMessage('Failed to commit session.');
      addToast('error', 'Failed to commit items to inventory.');
      isBusyRef.current = false;
    }
  };

  return {
    showCommitModal,
    setShowCommitModal,
    categories,
    categoriesLoading,
    itemCategories,
    setItemCategories,
    modalSelectedIds,
    setModalSelectedIds,
    bulkCategoryId,
    setBulkCategoryId,
    openCommitModal,
    confirmCommit,
  };
}
