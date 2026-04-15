import { useState } from 'react';
import { StoreRow, StoreUser, validateEmail } from '../components/superadmin/types';

export function useStoreUsers() {
  const [usersStore, setUsersStore] = useState<StoreRow | null>(null);
  const [storeUsers, setStoreUsers] = useState<StoreUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');

  const [userActionMode, setUserActionMode] = useState<'create' | 'existing'>('create');
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'owner' | 'taker'>('owner');
  const [addingUser, setAddingUser] = useState(false);
  const [addError, setAddError] = useState('');

  const [resetResult, setResetResult] = useState<{ username: string; tempPassword: string } | null>(null);
  const [resettingUserId, setResettingUserId] = useState<number | null>(null);

  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<number | null>(null);

  const loadUsersForStore = async (storeId: number) => {
    const res = await fetch(`/api/admin/stores/${storeId}/users`, { credentials: 'include' });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
          ? data.error
          : 'Failed to load store users';
      throw new Error(message);
    }
    setStoreUsers(Array.isArray(data) ? data : []);
  };

  const openUsers = async (store: StoreRow) => {
    setUsersStore(store);
    setAddError('');
    setUsersError('');
    setUserActionMode('create');
    setNewUsername('');
    setNewEmail('');
    setResetResult(null);
    setConfirmDeleteUserId(null);
    setUsersLoading(true);
    try {
      await loadUsersForStore(store.id);
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : 'Failed to load store users');
    } finally {
      setUsersLoading(false);
    }
  };

  const closeUsers = () => {
    setUsersStore(null);
    setConfirmDeleteUserId(null);
    setUsersError('');
  };

  const handleUserActionModeChange = (value: 'create' | 'existing') => {
    setUserActionMode(value);
    setAddError('');
    if (value === 'existing') {
      setNewEmail('');
    }
  };

  const addUser = async () => {
    if (!usersStore || !newUsername.trim()) return;

    if (userActionMode === 'create' && newEmail.trim() && !validateEmail(newEmail.trim())) {
      setAddError('Enter a valid email address');
      return;
    }

    setAddingUser(true);
    setAddError('');
    try {
      const res = await fetch(`/api/admin/stores/${usersStore.id}/users`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: userActionMode,
          username: newUsername.trim(),
          email: userActionMode === 'create' ? newEmail.trim() || undefined : undefined,
          role: newRole,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Failed to add user';
        setAddError(message);
        return;
      }
      await loadUsersForStore(usersStore.id);
      setNewUsername('');
      setNewEmail('');
      if (data && typeof data === 'object' && 'tempPassword' in data && typeof data.tempPassword === 'string') {
        setResetResult({ username: data.username, tempPassword: data.tempPassword });
      }
    } catch {
      setAddError('Failed to add user');
    } finally {
      setAddingUser(false);
    }
  };

  const removeUser = async (userId: number) => {
    if (!usersStore) return;
    const res = await fetch(`/api/admin/stores/${usersStore.id}/users/${userId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setUsersError(data.error || 'Failed to remove user');
      return;
    }
    setStoreUsers(prev => prev.filter(u => u.id !== userId));
    setConfirmDeleteUserId(null);
  };

  const handleResetPassword = async (userId: number) => {
    setResettingUserId(userId);
    setUsersError('');
    try {
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        setResetResult({ username: data.username, tempPassword: data.tempPassword });
      } else {
        setUsersError(data.error || 'Failed to reset password');
      }
    } catch {
      setUsersError('Failed to reset password');
    } finally {
      setResettingUserId(null);
    }
  };

  return {
    usersStore, storeUsers, usersLoading, usersError, setUsersError,
    userActionMode, handleUserActionModeChange,
    newUsername, setNewUsername, newEmail, setNewEmail, newRole, setNewRole, addingUser, addError,
    resetResult, setResetResult, resettingUserId,
    confirmDeleteUserId, setConfirmDeleteUserId,
    openUsers, closeUsers, addUser, removeUser, handleResetPassword,
  };
}
