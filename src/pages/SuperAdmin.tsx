import React, { useEffect } from 'react';
import { useReducedMotion } from 'motion/react';
import { Store, Package, ShieldCheck, ShieldOff, LogOut } from 'lucide-react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAdminStores } from '../hooks/useAdminStores';
import { useStoreUsers } from '../hooks/useStoreUsers';
import { StoreTable }        from '../components/superadmin/StoreTable';
import { EditStoreModal }    from '../components/superadmin/EditStoreModal';
import { DeleteStoreModal }  from '../components/superadmin/DeleteStoreModal';
import { StoreUsersModal }   from '../components/superadmin/StoreUsersModal';
import { ResetPasswordModal } from '../components/superadmin/ResetPasswordModal';

export default function SuperAdmin() {
  const prefersReducedMotion = useReducedMotion();

  const admin = useAdminStores();
  const users = useStoreUsers();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { admin.fetchStores(); }, []);

  const active    = admin.stores.filter(s => s.status === 'active').length;
  const suspended = admin.stores.filter(s => s.status === 'suspended').length;
  const totalItems = admin.stores.reduce((n, s) => n + (s.item_count || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top nav */}
      <header className="h-16 flex items-center justify-between px-6 bg-navy-900">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white rounded-lg flex items-center justify-center font-bold text-base text-navy-900">
            OC
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-tight">OptiCapture</h1>
            <p className="text-xs text-slate-400 leading-tight">Super Admin</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-white bg-navy-800">
            <ShieldCheck size={15} className="text-emerald-500" />
            <span className="text-sm font-medium">superadmin</span>
          </div>
          <button
            onClick={admin.handleLogout}
            className="flex items-center gap-2 text-slate-400 hover:text-white hover:bg-white/10 transition-colors text-sm px-3 py-1.5 rounded-lg"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Page-level error banner */}
        {admin.actionError && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="flex-1">{admin.actionError}</span>
            <button onClick={() => admin.setActionError('')} className="text-red-400 hover:text-red-600">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Stores', value: admin.stores.length, icon: Store,      color: 'text-navy-900' },
            { label: 'Active',       value: active,              icon: ShieldCheck, color: 'text-emerald-600' },
            { label: 'Suspended',    value: suspended,           icon: ShieldOff,   color: 'text-red-500' },
            { label: 'Total Items',  value: totalItems.toLocaleString(), icon: Package, color: 'text-slate-700' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Icon size={16} className={color} />
                <p className="text-xs text-slate-500 uppercase font-semibold">{label}</p>
              </div>
              <p className={cn('text-2xl font-bold', color)}>{value}</p>
            </div>
          ))}
        </div>

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
          onEdit={admin.openEdit}
          onUsers={users.openUsers}
          onToggleStatus={admin.toggleStatus}
          onDelete={admin.openDeleteConfirm}
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
          onClose={() => { admin.openDeleteConfirm(null as any); admin.setDeleteConfirmName(''); }}
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
    </div>
  );
}
