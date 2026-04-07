import { Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStoreSettings } from '../../hooks/useStoreSettings';
import { StoreCodeCard } from './StoreCodeCard';
import { StoreInfoCard } from './StoreInfoCard';
import { StorePasswordCard } from './StorePasswordCard';

export function StoreSettingsScreen() {
  const { user } = useAuth();
  const isTaker = user?.role === 'taker';
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
          Manage your store profile, branding and account security
        </p>
      </div>

      {storeSettings.storeCode && (
        <StoreCodeCard
          storeCode={storeSettings.storeCode}
          showCode={storeSettings.showCode}
          codeCopied={storeSettings.codeCopied}
          onToggleVisibility={storeSettings.toggleCodeVisibility}
          onCopy={storeSettings.copyStoreCode}
        />
      )}

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

      <StorePasswordCard
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
