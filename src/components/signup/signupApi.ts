import type { SignupFormData } from './types';

interface PendingGoogleProfile {
  email: string;
  name: string;
}

interface RegisterStoreResult {
  redirect?: string;
  storeCode?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
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

export async function fetchPendingGoogleProfile(pendingKey: string): Promise<PendingGoogleProfile> {
  const res = await fetch(`/api/auth/google/pending?key=${pendingKey}`);

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, 'Could not load Google signup details.'));
  }

  const data = await res.json().catch(() => null);
  if (!isRecord(data)) {
    throw new Error('Invalid response while loading Google signup details.');
  }

  return {
    email: readString(data.email),
    name: readString(data.name),
  };
}

export async function registerStore(
  formData: SignupFormData,
  pendingKey: string | null
): Promise<RegisterStoreResult> {
  const body: Record<string, string> = {
    store_name: formData.storeName.trim(),
    street: formData.street.trim(),
    zipcode: formData.zipcode,
    state: formData.state,
    phone: formData.phone,
    email: formData.email.trim(),
    username: formData.username.trim(),
    password: formData.password,
  };

  if (pendingKey) {
    body.oauth_key = pendingKey;
  }

  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, 'Registration failed'));
  }

  const data = await res.json().catch(() => null);
  if (!isRecord(data)) {
    throw new Error('Invalid response while creating your store.');
  }

  return {
    redirect: readString(data.redirect) || undefined,
    storeCode: readString(data.store_code) || undefined,
  };
}
