import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MutableRefObject,
} from 'react';
import {
  EMPTY_PASSWORD_FORM,
  EMPTY_STORE_INFO,
  type PasswordField,
  type StoreInfoField,
  validatePasswordForm,
  validateStoreInfo,
} from '../components/store-settings/types';
import {
  fetchStoreSettings,
  saveStoreSettings,
  updateStorePassword,
} from '../components/store-settings/storeSettingsApi';
import { useAuth } from '../context/AuthContext';
import { isSupportedUploadImageType, readFileAsDataUrl, SUPPORTED_UPLOAD_IMAGE_ERROR } from '../lib/imageUpload';

const SUCCESS_RESET_MS = 3000;
const COPIED_RESET_MS = 2000;

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function clearTimer(timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>): void {
  if (timerRef.current) {
    globalThis.clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

function scheduleReset(
  timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  callback: () => void,
  delay: number
): void {
  clearTimer(timerRef);
  timerRef.current = globalThis.setTimeout(callback, delay);
}



export function useStoreSettings(isTaker: boolean) {
  const { refreshUser } = useAuth();
  const [storeInfo, setStoreInfo] = useState(EMPTY_STORE_INFO);
  const [passwordForm, setPasswordForm] = useState(EMPTY_PASSWORD_FORM);
  const [infoErrors, setInfoErrors] = useState<Record<string, string>>({});
  const [storeSaving, setStoreSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [storeSuccess, setStoreSuccess] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [storeError, setStoreError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [loading, setLoading] = useState(true);
  const [storeCode, setStoreCode] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const storeSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passwordSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      clearTimer(storeSuccessTimerRef);
      clearTimer(passwordSuccessTimerRef);
      clearTimer(codeCopiedTimerRef);
    };
  }, []);

  const loadStoreSettings = useCallback(async () => {
    setLoading(true);
    setStoreError('');

    try {
      const data = await fetchStoreSettings();
      setStoreInfo(data.storeInfo);
      setStoreCode(data.storeCode);
    } catch (error) {
      setStoreError(getErrorMessage(error, 'An error occurred while loading store settings.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStoreSettings();
  }, [loadStoreSettings]);

  const handleStoreInfoChange = useCallback((field: StoreInfoField, value: string) => {
    setStoreInfo(prev => ({ ...prev, [field]: value }));
    setInfoErrors(prev => {
      if (!prev[field]) {
        return prev;
      }

      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const handleZipcodeChange = useCallback(
    (value: string) => {
      handleStoreInfoChange('zipcode', value.replaceAll(/[^\d-]/g, '').slice(0, 10));
    },
    [handleStoreInfoChange]
  );

  const handlePasswordChange = useCallback((field: PasswordField, value: string) => {
    setPasswordForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleLogoFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];

    input.value = '';
    if (!file) {
      return;
    }

    setStoreError('');

    if (!isSupportedUploadImageType(file)) {
      setStoreError(SUPPORTED_UPLOAD_IMAGE_ERROR);
      return;
    }

    try {
      const logo = await readFileAsDataUrl(file);
      setStoreInfo(prev => ({ ...prev, logo }));
    } catch (error) {
      setStoreError(getErrorMessage(error, 'Could not read selected logo.'));
    }
  }, []);

  const removeLogo = useCallback(() => {
    setStoreInfo(prev => ({ ...prev, logo: '' }));
  }, []);

  const toggleCodeVisibility = useCallback(() => {
    setShowCode(prev => !prev);
  }, []);

  const copyStoreCode = useCallback(async () => {
    if (!storeCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(storeCode);
      setCodeCopied(true);
      scheduleReset(codeCopiedTimerRef, () => setCodeCopied(false), COPIED_RESET_MS);
    } catch {
      setStoreError('Could not copy store code.');
    }
  }, [storeCode]);

  const handleStoreSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (isTaker) {
        return;
      }

      setStoreError('');
      setStoreSuccess('');
      clearTimer(storeSuccessTimerRef);

      const errors = validateStoreInfo(storeInfo);
      if (Object.keys(errors).length > 0) {
        setInfoErrors(errors);
        return;
      }

      setInfoErrors({});
      setStoreSaving(true);

      try {
        const data = await saveStoreSettings(storeInfo);
        setStoreInfo(data.storeInfo);
        setStoreCode(data.storeCode);
        await refreshUser().catch(() => null);
        setStoreSuccess('Store information updated.');
        scheduleReset(storeSuccessTimerRef, () => setStoreSuccess(''), SUCCESS_RESET_MS);
      } catch (error) {
        setStoreError(
          getErrorMessage(error, 'An error occurred while updating store information.')
        );
      } finally {
        setStoreSaving(false);
      }
    },
    [isTaker, refreshUser, storeInfo]
  );

  const handlePasswordSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      setPasswordError('');
      setPasswordSuccess('');
      clearTimer(passwordSuccessTimerRef);

      const validationError = validatePasswordForm(passwordForm);
      if (validationError) {
        setPasswordError(validationError);
        return;
      }

      setPasswordSaving(true);

      try {
        await updateStorePassword(passwordForm);
        await refreshUser().catch(() => null);
        setPasswordSuccess('Password updated successfully.');
        setPasswordForm(EMPTY_PASSWORD_FORM);
        scheduleReset(passwordSuccessTimerRef, () => setPasswordSuccess(''), SUCCESS_RESET_MS);
      } catch (error) {
        setPasswordError(getErrorMessage(error, 'An error occurred while updating password.'));
      } finally {
        setPasswordSaving(false);
      }
    },
    [passwordForm, refreshUser]
  );

  return {
    loading,
    storeInfo,
    passwordForm,
    infoErrors,
    storeSaving,
    passwordSaving,
    storeSuccess,
    passwordSuccess,
    storeError,
    passwordError,
    storeCode,
    codeCopied,
    showCode,
    handleStoreInfoChange,
    handleZipcodeChange,
    handlePasswordChange,
    handleLogoFileChange,
    removeLogo,
    toggleCodeVisibility,
    copyStoreCode,
    handleStoreSubmit,
    handlePasswordSubmit,
  };
}
