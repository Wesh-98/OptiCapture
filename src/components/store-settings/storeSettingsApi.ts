import { EMPTY_STORE_INFO, type PasswordForm, type StoreInfo } from './types';

interface StoreSettingsPayload {
  storeCode: string;
  storeInfo: StoreInfo;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeStoreSettingsPayload(data: unknown): StoreSettingsPayload {
  if (!isRecord(data)) {
    throw new Error('Invalid response while loading store settings.');
  }

  return {
    storeCode: readString(data.store_code).trim(),
    storeInfo: {
      ...EMPTY_STORE_INFO,
      name: readString(data.name),
      street: readString(data.street),
      zipcode: readString(data.zipcode),
      state: readString(data.state),
      phone: readString(data.phone),
      email: readString(data.email),
      logo: readString(data.logo),
    },
  };
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    if (payload?.error) {
      return payload.error;
    }
  }

  const text = await res.text().catch(() => '');
  return text.trim() || fallback;
}

export async function fetchStoreSettings(): Promise<StoreSettingsPayload> {
  const res = await fetch('/api/auth/store/settings', { credentials: 'include' });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, 'Failed to load store settings.'));
  }

  const data = await res.json().catch(() => null);
  return normalizeStoreSettingsPayload(data);
}

export async function saveStoreSettings(storeInfo: StoreInfo): Promise<StoreSettingsPayload> {
  const res = await fetch('/api/auth/store/settings', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(storeInfo),
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, 'Failed to update store information.'));
  }

  const data = await res.json().catch(() => null);
  return normalizeStoreSettingsPayload(data);
}

export async function updateStorePassword(passwordForm: PasswordForm): Promise<void> {
  const res = await fetch('/api/auth/store/password', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      current_password: passwordForm.current_password,
      new_password: passwordForm.new_password,
    }),
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, 'Failed to update password.'));
  }
}
