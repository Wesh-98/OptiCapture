import { useState } from 'react';
import { StoreRow, StoreUser } from '../components/superadmin/types';

export function useStoreUsers() {
  const [usersStore, setUsersStore] = useState<StoreRow | null>(null);
  const [storeUsers, setStoreUsers] = useState<StoreUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');

  const [newUsername, setNewUsername] = useState('');
  const [newRole, setNewRole] = useState<'owner' | 'taker'>('owner');
  const [addingUser, setAddingUser] = useState(false);
  const [addError, setAddError] = useState('');

  const [resetResult, setResetResult] = useState<{ username: string; tempPassword: string } | null>(null);
  const [resettingUserId, setResettingUserId] = useState<number | null>(null);

  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<number | null>(null);

  const openUsers = async (store: StoreRow) => {
    setUsersStore(store);
    setAddError('');
    setUsersError('');
    setNewUsername('');
    setConfirmDeleteUserId(null);
    setUsersLoading(true);
    try {
      const res = await fetch(`/api/admin/stores/${store.id}/users`, { credentials: 'include' });
      if (res.ok) setStoreUsers(await res.json());
    } finally {
      setUsersLoading(false);
    }
  };

  const closeUsers = () => {
    setUsersStore(null);
    setConfirmDeleteUserId(null);
    setUsersError('');
  };

  const addUser = async () => {
    if (!usersStore || !newUsername.trim()) return;
    setAddingUser(true);
    setAddError('');
    try {
      const res = await fetch(`/api/admin/stores/${usersStore.id}/users`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername.trim(), role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error || 'Failed to add user'); return; }
      // Append the new user directly from the response rather than re-fetching
      setStoreUsers(prev => [...prev, data]);
      setNewUsername('');
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
    newUsername, setNewUsername, newRole, setNewRole, addingUser, addError,
    resetResult, setResetResult, resettingUserId,
    confirmDeleteUserId, setConfirmDeleteUserId,
    openUsers, closeUsers, addUser, removeUser, handleResetPassword,
  };
}
