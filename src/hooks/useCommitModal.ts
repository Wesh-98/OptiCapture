import { useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Category, SessionItem, UiStatus } from '../components/scan/types';

export function isCommitEligibleItem(item: SessionItem): boolean {
  return item.lookup_status === 'new_candidate' && item.exists_in_inventory !== 1;
}

export function getCommitEligibleItems(
  items: SessionItem[],
  selectedIds: Set<number>
): SessionItem[] {
  return items.filter(item => selectedIds.has(item.id) && isCommitEligibleItem(item));
}

export function buildCommitAssignments(
  items: SessionItem[],
  selectedIds: Set<number>,
  itemCategories: Map<number, number>
): Array<{ id: number; category_id: number }> {
  return getCommitEligibleItems(items, selectedIds)
    .filter(item => itemCategories.has(item.id))
    .map(item => ({
      id: item.id,
      category_id: itemCategories.get(item.id)!,
    }));
}

export function getBulkCategoryTargetIds(
  items: SessionItem[],
  selectedIds: Set<number>,
  modalSelectedIds: Set<number>
): number[] {
  const eligibleItems = getCommitEligibleItems(items, selectedIds);
  const targetIds =
    modalSelectedIds.size > 0 ? modalSelectedIds : new Set(eligibleItems.map(item => item.id));

  return eligibleItems.filter(item => targetIds.has(item.id)).map(item => item.id);
}

// Opens commit modal, fetches categories, handles per-item category assignments and commit.
export function useCommitModal(
  sessionId: string | null,
  selectedIds: Set<number>,
  items: SessionItem[],
  isBusyRef: MutableRefObject<boolean>,
  lastPollCursorRef: MutableRefObject<{ updatedAt: string; id: number } | null>,
  refreshSession: (fullRefresh?: boolean) => Promise<void>,
  setUiStatus: (s: UiStatus) => void,
  setStatusMessage: (m: string) => void,
  addToast: (type: 'success' | 'error' | 'warning', message: string) => void
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
    if (getCommitEligibleItems(items, selectedIds).length === 0) {
      addToast('warning', 'Select at least one new item before committing.');
      return;
    }

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
    const commitEligibleItems = getCommitEligibleItems(items, selectedIds);
    if (commitEligibleItems.some(item => !itemCategories.has(item.id))) {
      addToast('warning', 'Assign a category to every new item before committing.');
      return;
    }
    const assignments = buildCommitAssignments(items, selectedIds, itemCategories);
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
        toastMsg = `${result.inserted ?? 0} committed - ${result.skippedExisting ?? 0} duplicate${dupSuffix}, ${result.skippedUnknown ?? 0} unknown skipped`;
      } else {
        toastMsg = `${result.inserted ?? 0} item(s) committed to inventory`;
      }
      addToast(result.inserted > 0 ? 'success' : 'warning', toastMsg);
      setItemCategories(new Map());
      setModalSelectedIds(new Set());
      setBulkCategoryId(null);
      lastPollCursorRef.current = null;
      await refreshSession(true);
      setUiStatus('ready');
      setStatusMessage(
        result.status === 'completed'
          ? 'Session committed to inventory. View only.'
          : result.status === 'draft'
            ? 'Draft mode. Resume scanning when you are ready.'
            : 'Session ready. Scan the QR code with your phone.'
      );
    } catch {
      setUiStatus('error');
      setStatusMessage('Failed to commit session.');
      addToast('error', 'Failed to commit items to inventory.');
    } finally {
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
