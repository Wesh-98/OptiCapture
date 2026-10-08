import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';
import { useAdminStores } from '../hooks/useAdminStores';
import { useStoreUsers } from '../hooks/useStoreUsers';
import { AdminLayout } from '../components/superadmin/AdminLayout';
import { StoreTable } from '../components/superadmin/StoreTable';
import { EditStoreModal } from '../components/superadmin/EditStoreModal';
import { DeleteStoreModal } from '../components/superadmin/DeleteStoreModal';
import { StoreUsersModal } from '../components/superadmin/StoreUsersModal';
import { ResetPasswordModal } from '../components/superadmin/ResetPasswordModal';

export default function SuperAdmin() {
  const prefersReducedMotion = useReducedMotion();
  const navigate = useNavigate();

  const admin = useAdminStores();
  const users = useStoreUsers();
  const { fetchStores } = admin;

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  // Selected store IDs. The live selection is read through the current store list, so a
  // store that is deleted or refreshed away stops counting as selected.
  const [rawSelectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  const selectedIds = useMemo<ReadonlySet<number>>(
    () => new Set(admin.stores.map(store => store.id).filter(id => rawSelectedIds.has(id))),
    [admin.stores, rawSelectedIds]
  );

  const toggleStore = (id: number) =>
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllVisible = () =>
    setSelectedIds(prev => {
      const visible = admin.filteredStores.map(store => store.id);
      const next = new Set(prev);
      if (visible.every(id => prev.has(id))) visible.forEach(id => next.delete(id));
      else visible.forEach(id => next.add(id));
      return next;
    });

  return (
    <AdminLayout onLogout={admin.handleLogout}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-black">Stores</h1>
          <p className="mt-1 text-sm font-medium text-theme-muted">
            Manage stores and open any store's inventory
          </p>
        </div>

        {/* Page-level error banner */}
        {admin.actionError && (
          <div className="flex items-center gap-2 px-4 py-3 bg-accent-50 border border-accent-100 rounded-xl text-sm text-accent-700">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="flex-1">{admin.actionError}</span>
            <button
              onClick={() => admin.setActionError('')}
              className="text-accent-400 hover:text-accent-600"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <StoreTable
          stores={admin.stores}
          filteredStores={admin.filteredStores}
          isLoading={admin.isLoading}
          togglingId={admin.togglingId}
          storeSearch={admin.storeSearch}
          statusFilter={admin.statusFilter}
          joinedSort={admin.joinedSort}
          prefersReducedMotion={prefersReducedMotion}
          onSearch={admin.setStoreSearch}
          onStatusFilter={admin.setStatusFilter}
          onJoinedSort={admin.setJoinedSort}
          onRefresh={admin.fetchStores}
          onInventory={store => navigate(`/admin/stores/${store.id}`)}
          onEdit={admin.openEdit}
          onUsers={users.openUsers}
          onToggleStatus={admin.toggleStatus}
          onDelete={admin.openDeleteConfirm}
          selectedIds={selectedIds}
          onToggleStore={toggleStore}
          onToggleAll={toggleAllVisible}
          onClearSelection={() => setSelectedIds(new Set())}
        />
      </div>

      {admin.editStore && (
        <EditStoreModal
          store={admin.editStore}
          saving={admin.editSaving}
          error={admin.editError}
          fieldErrors={admin.editErrors}
          onChange={admin.setEditStore}
          onFileUpload={admin.handleFileUpload}
          onRemoveLogo={admin.removeLogo}
          onSave={admin.handleEditSave}
          onClose={() => admin.setEditStore(null)}
        />
      )}

      {admin.deleteStore && (
        <DeleteStoreModal
          store={admin.deleteStore}
          confirmName={admin.deleteConfirmName}
          deleting={admin.deleting}
          onConfirmNameChange={admin.setDeleteConfirmName}
          onDelete={admin.handleDeleteStore}
          onClose={() => {
            admin.openDeleteConfirm(null as any);
            admin.setDeleteConfirmName('');
          }}
        />
      )}

      {users.usersStore && (
        <StoreUsersModal
          store={users.usersStore}
          users={users.storeUsers}
          loading={users.usersLoading}
          error={users.usersError}
          userActionMode={users.userActionMode}
          newUsername={users.newUsername}
          newEmail={users.newEmail}
          newRole={users.newRole}
          addingUser={users.addingUser}
          addError={users.addError}
          resettingUserId={users.resettingUserId}
          confirmDeleteUserId={users.confirmDeleteUserId}
          onUserActionMode={users.handleUserActionModeChange}
          onNewUsername={users.setNewUsername}
          onNewEmail={users.setNewEmail}
          onNewRole={users.setNewRole}
          onAddUser={users.addUser}
          onRemoveUser={users.removeUser}
          onResetPassword={users.handleResetPassword}
          onConfirmDelete={users.setConfirmDeleteUserId}
          onClose={users.closeUsers}
        />
      )}

      {users.resetResult && (
        <ResetPasswordModal
          username={users.resetResult.username}
          tempPassword={users.resetResult.tempPassword}
          prefersReducedMotion={prefersReducedMotion}
          onClose={() => users.setResetResult(null)}
        />
      )}
    </AdminLayout>
  );
}
