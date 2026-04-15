import { Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStoreSettings } from '../../hooks/useStoreSettings';
import { StoreCodeCard } from './StoreCodeCard';
import { StoreInfoCard } from './StoreInfoCard';
import { StorePasswordCard } from './StorePasswordCard';

export function StoreSettingsScreen() {
  const { user } = useAuth();
  const isTaker = user?.role === 'taker';
  const mustResetPassword = Boolean(user?.must_reset_password);
  const storeSettings = useStoreSettings(isTaker);

  if (storeSettings.loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <Loader2 className="animate-spin text-navy-900" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Store Settings</h1>
        <p className="text-slate-500 mt-1">
          {mustResetPassword
            ? 'Set a new password before continuing into the app'
            : 'Manage your store profile, branding and account security'}
        </p>
      </div>

      {mustResetPassword && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          Your account was created or reset with a temporary password. Update it here to unlock
          the rest of the app.
        </div>
      )}

      {!mustResetPassword && storeSettings.storeCode && (
        <StoreCodeCard
          storeCode={storeSettings.storeCode}
          showCode={storeSettings.showCode}
          codeCopied={storeSettings.codeCopied}
          onToggleVisibility={storeSettings.toggleCodeVisibility}
          onCopy={storeSettings.copyStoreCode}
        />
      )}

      {!mustResetPassword && (
        // Store profile edits stay hidden until the user replaces their temporary password.
        <StoreInfoCard
          storeInfo={storeSettings.storeInfo}
          infoErrors={storeSettings.infoErrors}
          isTaker={isTaker}
          storeSaving={storeSettings.storeSaving}
          storeSuccess={storeSettings.storeSuccess}
          storeError={storeSettings.storeError}
          onFieldChange={storeSettings.handleStoreInfoChange}
          onZipcodeChange={storeSettings.handleZipcodeChange}
          onLogoFileChange={storeSettings.handleLogoFileChange}
          onRemoveLogo={storeSettings.removeLogo}
          onSubmit={storeSettings.handleStoreSubmit}
        />
      )}

      <StorePasswordCard
        mustResetPassword={mustResetPassword}
        passwordForm={storeSettings.passwordForm}
        passwordSaving={storeSettings.passwordSaving}
        passwordSuccess={storeSettings.passwordSuccess}
        passwordError={storeSettings.passwordError}
        onFieldChange={storeSettings.handlePasswordChange}
        onSubmit={storeSettings.handlePasswordSubmit}
      />
    </div>
  );
}
