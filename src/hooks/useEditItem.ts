import { useState } from 'react';
import type { SessionItem, EditDraft } from '../components/scan/types';

export function useEditItem(
  sessionId: string | null,
  setItems: (updater: (prev: SessionItem[]) => SessionItem[]) => void,
  setSelectedIds: (updater: (prev: Set<number>) => Set<number>) => void,
  addToast: (type: 'success' | 'error' | 'warning', message: string) => void,
) {
  const [editItem, setEditItem] = useState<EditDraft | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const openEdit = (item: SessionItem) => {
    setEditItem({
      id: item.id,
      product_name: item.product_name || '',
      brand: item.brand || '',
      quantity: item.quantity,
      upc: item.upc || '',
      image: item.image || '',
      tag_names: (item as any).tag_names || '',
      sale_price: String(item.sale_price ?? ''),
      unit: item.unit ?? '',
    });
  };

  const saveEdit = async () => {
    if (!editItem || !sessionId) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/session/${sessionId}/items/${editItem.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: editItem.product_name,
          brand: editItem.brand,
          quantity: editItem.quantity,
          upc: editItem.upc,
          image: editItem.image,
          tag_names: editItem.tag_names,
          sale_price: editItem.sale_price || null,
          unit: editItem.unit || null,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      setItems(prev => prev.map(i => {
        if (i.id !== editItem.id) return i;
        return {
          ...i,
          product_name: editItem.product_name || null,
          brand: editItem.brand || null,
          quantity: editItem.quantity,
          upc: editItem.upc,
          image: editItem.image || null,
          lookup_status: 'new_candidate',
          sale_price: editItem.sale_price ? Number.parseFloat(editItem.sale_price) : null,
          unit: editItem.unit || null,
        };
      }));
      setSelectedIds(prev => new Set([...prev, editItem.id]));
      setEditItem(null);
    } catch {
      addToast('error', 'Failed to save changes.');
    } finally {
      setEditSaving(false);
    }
  };

  const deleteItem = async (itemId: number) => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/session/${sessionId}/items/${itemId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Delete failed');
      setItems(prev => prev.filter(i => i.id !== itemId));
      setSelectedIds(prev => { const next = new Set(prev); next.delete(itemId); return next; });
    } catch {
      addToast('error', 'Failed to delete item');
    }
  };

  return {
    editItem,
    setEditItem,
    editSaving,
    openEdit,
    saveEdit,
    deleteItem,
  };
}
