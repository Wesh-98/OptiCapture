import { useCallback, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  StoreRow,
  validateEmail,
  validatePhone,
  validateZipcode,
} from '../components/superadmin/types';
import { isSupportedUploadImageType, SUPPORTED_UPLOAD_IMAGE_ERROR } from '../lib/imageUpload';

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    if (payload?.error) return payload.error;
  }
  const text = await res.text().catch(() => '');
  return text.trim() || fallback;
}

//Store list, create/edit/suspend/delete stores, logo upload
export function useAdminStores() {
  const navigate = useNavigate();

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState('');

  // --- Store status toggle ---
  const [togglingId, setTogglingId] = useState<number | null>(null);

  // --- Edit modal ---
  const [editStore, setEditStore] = useState<StoreRow | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  // --- Delete modal ---
  const [deleteStore, setDeleteStore] = useState<StoreRow | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  // --- Filter / sort ---
  const [storeSearch, setStoreSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [joinedSort, setJoinedSort] = useState<'newest' | 'oldest'>('newest');

  const fetchStores = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/stores', { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        navigate('/login');
        return;
      }
      if (res.ok) setStores(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, [navigate]);

  const toggleStatus = async (store: StoreRow) => {
    const newStatus = store.status === 'active' ? 'suspended' : 'active';
    setTogglingId(store.id);
    try {
      const res = await fetch(`/api/admin/stores/${store.id}/status`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setStores(prev => prev.map(s => (s.id === store.id ? { ...s, status: newStatus } : s)));
      } else {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error || 'Failed to update store status');
      }
    } finally {
      setTogglingId(null);
    }
  };

  const openEdit = (store: StoreRow) => {
    setEditStore({ ...store });
    setEditError('');
    setEditErrors({});
  };

  const handleEditSave = async () => {
    if (!editStore) return;
    const errs: Record<string, string> = {};
    if (!editStore.name.trim()) errs.name = 'Store name is required';
    if (editStore.email && !validateEmail(editStore.email)) errs.email = 'Enter a valid email';
    if (editStore.phone && !validatePhone(editStore.phone)) errs.phone = 'Phone must be 10 digits';
    if (editStore.zipcode && !validateZipcode(editStore.zipcode))
      errs.zipcode = 'Format: 12345 or 12345-6789';
    if (Object.keys(errs).length) {
      setEditErrors(errs);
      return;
    }
    setEditErrors({});
    setEditSaving(true);
    setEditError('');
    try {
      const res = await fetch(`/api/admin/stores/${editStore.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editStore.name,
          street: editStore.street,
          zipcode: editStore.zipcode,
          state: editStore.state,
          phone: editStore.phone,
          email: editStore.email,
          logo: editStore.logo,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setStores(prev => prev.map(s => (s.id === editStore.id ? { ...s, ...updated } : s)));
        setEditStore(null);
      } else {
        setEditError(await readErrorMessage(res, 'Failed to save changes'));
      }
    } catch {
      setEditError('Failed to save changes');
    } finally {
      setEditSaving(false);
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editStore) return;
    if (file.size > MAX_LOGO_BYTES) {
      setEditError('Logo must be under 2 MB');
      e.target.value = '';
      return;
    }
    if (!isSupportedUploadImageType(file)) {
      setEditError(SUPPORTED_UPLOAD_IMAGE_ERROR);
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setEditStore({ ...editStore, logo: reader.result as string });
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    if (editStore) setEditStore({ ...editStore, logo: null });
  };

  const openDeleteConfirm = (store: StoreRow) => {
    setDeleteStore(store);
    setDeleteConfirmName('');
  };

  const handleDeleteStore = async () => {
    if (!deleteStore || deleteConfirmName !== deleteStore.name) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/stores/${deleteStore.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setStores(prev => prev.filter(s => s.id !== deleteStore.id));
        setDeleteStore(null);
        setDeleteConfirmName('');
      } else {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error || 'Failed to delete store');
        setDeleteStore(null);
      }
    } catch {
      setActionError('Failed to delete store');
      setDeleteStore(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    navigate('/login');
  };

  const filteredStores = stores
    .filter(s => {
      const q = storeSearch.trim().toLowerCase();
      if (q && !s.name.toLowerCase().includes(q) && !(s.email ?? '').toLowerCase().includes(q))
        return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      return true;
    })
    .sort((a, b) => {
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return joinedSort === 'newest' ? -diff : diff;
    });

  return {
    // data
    stores,
    filteredStores,
    isLoading,
    actionError,
    // status toggle
    togglingId,
    toggleStatus,
    // edit modal
    editStore,
    setEditStore,
    editSaving,
    editError,
    editErrors,
    openEdit,
    handleEditSave,
    handleFileUpload,
    removeLogo,
    // delete modal
    deleteStore,
    deleteConfirmName,
    setDeleteConfirmName,
    deleting,
    openDeleteConfirm,
    handleDeleteStore,
    // filters
    storeSearch,
    setStoreSearch,
    statusFilter,
    setStatusFilter,
    joinedSort,
    setJoinedSort,
    // actions
    fetchStores,
    handleLogout,
    setActionError,
  };
}
