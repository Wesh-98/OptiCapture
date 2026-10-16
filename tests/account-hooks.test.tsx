// @vitest-environment jsdom
/**
 * tests/account-hooks.test.tsx — signing a store up, and managing its settings
 *
 * Signup is the first thing a new store does; store settings is where it keeps its address,
 * logo, store code and password. Both pages are driven by a hook plus a small API client and
 * a set of validators, none of which had a test. The server side is in tests/auth.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEvent, FormEvent, PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const auth = vi.hoisted(() => ({ refreshUser: vi.fn() }));
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => auth }));

const { useSignupFlow } = await import('../src/hooks/useSignupFlow');
const { useStoreSettings } = await import('../src/hooks/useStoreSettings');
const signupTypes = await import('../src/components/signup/types');
const settingsTypes = await import('../src/components/store-settings/types');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Call = { url: string; method: string; body: any };

function stubFetch(route: (url: string, method: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return route(url, method);
    })
  );
  return calls;
}

const submit = () => ({ preventDefault: () => {} }) as FormEvent<HTMLFormElement>;

let clipboardWrite: ReturnType<typeof vi.fn>;

beforeEach(() => {
  auth.refreshUser.mockReset().mockResolvedValue({ id: 1 });
  clipboardWrite = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWrite },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── Validators ───────────────────────────────────────────────────────────────

describe('signup and store-settings validators', () => {
  it.each([signupTypes, settingsTypes])('share the same field rules', mod => {
    expect(mod.validateZipcode('')).toBe(true);
    expect(mod.validateZipcode('12345')).toBe(true);
    expect(mod.validateZipcode('12345-6789')).toBe(true);
    expect(mod.validateZipcode('1234')).toBe(false);
    expect(mod.validateZipcode('12345-67')).toBe(false);

    expect(mod.validatePhone('')).toBe(true);
    expect(mod.validatePhone('(555) 123-4567')).toBe(true);
    expect(mod.validatePhone('555-1234')).toBe(false);

    expect(mod.validateEmail('')).toBe(true);
    expect(mod.validateEmail('owner@shop.com')).toBe(true);
    expect(mod.validateEmail('owner@shop')).toBe(false);

    expect(mod.validatePassword('Password1')).toBe(true);
    expect(mod.validatePassword('Pass1')).toBe(false);
    expect(mod.validatePassword('password1')).toBe(false);
    expect(mod.validatePassword('Passwordx')).toBe(false);
  });

  it('flags every invalid signup field at once', () => {
    const errors = signupTypes.validateSignupForm(
      {
        ...signupTypes.EMPTY_SIGNUP_FORM,
        email: 'nope',
        phone: '123',
        city: 'x'.repeat(101),
        zipcode: '1',
        password: 'weak',
        confirmPassword: 'other',
      },
      false
    );
    expect(Object.keys(errors).sort()).toEqual([
      'city',
      'confirmPassword',
      'email',
      'password',
      'phone',
      'storeName',
      'username',
      'zipcode',
    ]);
  });

  it('accepts an email with the stray space a phone keyboard adds, since it is trimmed on send', () => {
    const errors = signupTypes.validateSignupForm(
      {
        ...signupTypes.EMPTY_SIGNUP_FORM,
        storeName: 'Shop',
        username: 'owner',
        email: 'owner@shop.com ',
        password: 'Password1',
        confirmPassword: 'Password1',
      },
      false
    );
    expect(errors).toEqual({});
  });

  it('does not ask a Google signup for a password', () => {
    const errors = signupTypes.validateSignupForm(
      { ...signupTypes.EMPTY_SIGNUP_FORM, storeName: 'Shop', username: 'owner' },
      true
    );
    expect(errors).toEqual({});
  });

  it('validates store info and the password form', () => {
    expect(
      settingsTypes.validateStoreInfo({ ...settingsTypes.EMPTY_STORE_INFO, name: ' ' })
    ).toEqual({
      name: 'Store name is required',
    });
    expect(
      settingsTypes.validateStoreInfo({
        ...settingsTypes.EMPTY_STORE_INFO,
        name: 'Shop',
        email: 'x',
        phone: '1',
        city: 'c'.repeat(101),
        zipcode: '9',
      })
    ).toEqual({
      email: 'Enter a valid email address',
      phone: 'Phone must be 10 digits',
      city: 'City/Town must be 100 characters or fewer',
      zipcode: 'Format: 12345 or 12345-6789',
    });

    const form = {
      current_password: 'Old1password',
      new_password: 'Newpass12',
      confirm_password: '',
    };
    expect(settingsTypes.validatePasswordForm({ ...form, new_password: 'short' })).toBe(
      'Min 8 chars, 1 uppercase letter, 1 number'
    );
    expect(settingsTypes.validatePasswordForm(form)).toBe(
      'New password and confirmation do not match.'
    );
    expect(
      settingsTypes.validatePasswordForm({ ...form, confirm_password: 'Newpass12' })
    ).toBeNull();
  });
});

// ── Signup ───────────────────────────────────────────────────────────────────

describe('useSignupFlow', () => {
  function mount(entry = '/signup') {
    let location = '';
    const Probe = ({ children }: PropsWithChildren) => {
      location = useLocation().pathname;
      return <>{children}</>;
    };
    const wrapper = ({ children }: PropsWithChildren) => (
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="*" element={<Probe>{children}</Probe>} />
        </Routes>
      </MemoryRouter>
    );
    const hook = renderHook(() => useSignupFlow(), { wrapper });
    return { ...hook, location: () => location };
  }

  function fillValid(result: { current: ReturnType<typeof useSignupFlow> }) {
    act(() => {
      result.current.handleFieldChange('storeName', '  Corner Shop ');
      result.current.handleFieldChange('username', ' owner ');
      result.current.handleFieldChange('street', ' 1 Main St ');
      result.current.handleFieldChange('city', ' Springfield ');
      result.current.handleFieldChange('email', ' owner@shop.com ');
      result.current.handleFieldChange('password', 'Password1');
      result.current.handleFieldChange('confirmPassword', 'Password1');
    });
  }

  it('shows field errors and sends nothing for an invalid form', async () => {
    const calls = stubFetch(() => jsonResponse({}));
    const { result } = mount();

    await act(() => result.current.handleSubmit(submit()));

    expect(result.current.errors).toMatchObject({
      storeName: 'Store name is required',
      username: 'Username is required',
      password: 'Min 8 chars, 1 uppercase letter, 1 number',
    });
    expect(calls).toHaveLength(0);

    // Fixing a field clears its error.
    act(() => result.current.handleFieldChange('storeName', 'Shop'));
    expect(result.current.errors.storeName).toBeUndefined();
    expect(result.current.errors.username).toBe('Username is required');
  });

  it('keeps only digits in the phone and zip boxes', () => {
    stubFetch(() => jsonResponse({}));
    const { result } = mount();
    act(() => {
      result.current.handlePhoneChange('(555) 123-4567 ext 89');
      result.current.handleZipcodeChange('12345-6789 extra');
    });
    expect(result.current.formData.phone).toBe('5551234567');
    expect(result.current.formData.zipcode).toBe('12345-6789');
  });

  it('registers the store with trimmed fields and shows the new store code', async () => {
    const calls = stubFetch(() => jsonResponse({ store_code: 'K7Q2XR' }, 201));
    const { result } = mount();
    fillValid(result);

    await act(() => result.current.handleSubmit(submit()));

    expect(calls[0]).toMatchObject({ url: '/api/auth/register', method: 'POST' });
    expect(calls[0].body).toEqual({
      store_name: 'Corner Shop',
      street: '1 Main St',
      city: 'Springfield',
      zipcode: '',
      state: '',
      phone: '',
      email: 'owner@shop.com',
      username: 'owner',
      password: 'Password1',
    });
    expect(result.current.registeredCode).toBe('K7Q2XR');
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.error).toBe('');
  });

  it("shows the server's reason when registration is refused", async () => {
    stubFetch(() => jsonResponse({ error: 'Username already taken' }, 409));
    const { result } = mount();
    fillValid(result);

    await act(() => result.current.handleSubmit(submit()));

    expect(result.current.error).toBe('Username already taken');
    expect(result.current.registeredCode).toBeNull();
  });

  it.each([
    ['a text reply', () => new Response('Service down', { status: 503 }), 'Service down'],
    ['an empty reply', () => new Response('', { status: 500 }), 'Registration failed'],
    [
      'a malformed success',
      () => new Response('<html>', { status: 200 }),
      'Invalid response while creating your store.',
    ],
  ])('reports %s', async (_label, reply, message) => {
    stubFetch(reply);
    const { result } = mount();
    fillValid(result);
    await act(() => result.current.handleSubmit(submit()));
    expect(result.current.error).toBe(message);
  });

  it('prefills a Google signup, then signs straight in on success', async () => {
    const calls = stubFetch(url =>
      url.startsWith('/api/auth/google/pending')
        ? jsonResponse({ email: 'g@shop.com', name: 'Google Shop' })
        : jsonResponse({ redirect: '/' }, 201)
    );
    const { result, location } = mount('/signup?pending=abc&123');

    await waitFor(() => expect(result.current.isGooglePrefilled).toBe(true));
    // The key is passed through encoded, so it cannot add parameters of its own.
    expect(calls[0].url).toBe('/api/auth/google/pending?key=abc');
    expect(result.current.formData.email).toBe('g@shop.com');
    expect(result.current.formData.storeName).toBe('Google Shop');

    act(() => result.current.handleFieldChange('username', 'gowner'));
    await act(() => result.current.handleSubmit(submit()));

    expect(calls[1].body.oauth_key).toBe('abc');
    expect(calls[1].body.password).toBe('');
    expect(auth.refreshUser).toHaveBeenCalled();
    expect(location()).toBe('/');
  });

  it('encodes a pending key with special characters', async () => {
    const calls = stubFetch(() => jsonResponse({ email: '', name: '' }));
    mount('/signup?pending=a%26key%3Db');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe('/api/auth/google/pending?key=a%26key%3Db');
  });

  it('keeps typed values when the Google profile is blank', async () => {
    stubFetch(() => jsonResponse({ email: 7, name: null }));
    const { result } = mount('/signup?pending=k');
    await waitFor(() => expect(result.current.isGooglePrefilled).toBe(true));
    expect(result.current.formData.email).toBe('');
    expect(result.current.formData.storeName).toBe('');
  });

  it('explains an expired Google signup', async () => {
    stubFetch(() =>
      jsonResponse({ error: 'Session expired. Please try signing in with Google again.' }, 404)
    );
    const { result } = mount('/signup?pending=old');
    await waitFor(() =>
      expect(result.current.error).toBe('Session expired. Please try signing in with Google again.')
    );
    expect(result.current.isGooglePrefilled).toBe(false);
  });

  it('rejects a Google profile answer that is not an object', async () => {
    stubFetch(() => jsonResponse(['x']));
    const { result } = mount('/signup?pending=k');
    await waitFor(() =>
      expect(result.current.error).toBe('Invalid response while loading Google signup details.')
    );
  });

  it('says so when the account was created but the sign-in could not be loaded', async () => {
    auth.refreshUser.mockResolvedValue(null);
    stubFetch(() => jsonResponse({ redirect: '/' }, 201));
    const { result, location } = mount();
    fillValid(result);

    await act(() => result.current.handleSubmit(submit()));

    expect(result.current.error).toBe(
      'Account created, but the sign-in session could not be loaded.'
    );
    expect(location()).toBe('/signup');
  });

  it('copies the store code, and resets the "copied" note after two seconds', async () => {
    stubFetch(() => jsonResponse({ store_code: 'K7Q2XR' }, 201));
    const { result } = mount();

    // Nothing to copy yet.
    await act(() => result.current.copyRegisteredCode());
    expect(clipboardWrite).not.toHaveBeenCalled();

    fillValid(result);
    await act(() => result.current.handleSubmit(submit()));
    vi.useFakeTimers();
    await act(() => result.current.copyRegisteredCode());
    expect(clipboardWrite).toHaveBeenCalledWith('K7Q2XR');
    expect(result.current.codeCopied).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.codeCopied).toBe(false);
  });

  it('reports a blocked clipboard', async () => {
    stubFetch(() => jsonResponse({ store_code: 'K7Q2XR' }, 201));
    clipboardWrite.mockRejectedValue(new Error('denied'));
    const { result } = mount();
    fillValid(result);
    await act(() => result.current.handleSubmit(submit()));

    await act(() => result.current.copyRegisteredCode());
    expect(result.current.error).toBe('Could not copy store code.');
  });

  it('goes to login, or hands off to Google', () => {
    stubFetch(() => jsonResponse({}));
    const { result, location } = mount();
    act(() => result.current.continueToLogin());
    expect(location()).toBe('/login');

    const original = globalThis.location;
    const fake = { href: '' };
    Object.defineProperty(globalThis, 'location', { configurable: true, value: fake });
    try {
      result.current.startGoogleSignup();
      expect(fake.href).toBe('/api/auth/google?intent=signup');
    } finally {
      Object.defineProperty(globalThis, 'location', { configurable: true, value: original });
    }
  });
});

// ── Store settings ───────────────────────────────────────────────────────────

describe('useStoreSettings', () => {
  const stored = {
    name: 'Corner Shop',
    street: '1 Main St',
    city: 'Springfield',
    zipcode: '12345',
    state: 'IL',
    phone: '5551234567',
    email: 'owner@shop.com',
    logo: '/uploads/logo.png',
    store_code: ' K7Q2XR ',
  };

  async function mount(isTaker = false) {
    const hook = renderHook(() => useStoreSettings(isTaker));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  }

  it('loads the store details and code', async () => {
    const calls = stubFetch(() => jsonResponse(stored));
    const { result } = await mount();

    expect(calls[0].url).toBe('/api/auth/store/settings');
    expect(result.current.storeCode).toBe('K7Q2XR');
    expect(result.current.storeInfo).toEqual({
      name: 'Corner Shop',
      street: '1 Main St',
      city: 'Springfield',
      zipcode: '12345',
      state: 'IL',
      phone: '5551234567',
      email: 'owner@shop.com',
      logo: '/uploads/logo.png',
    });
  });

  it('fills missing fields with blanks', async () => {
    stubFetch(() => jsonResponse({ name: 'Shop', phone: null }));
    const { result } = await mount();
    expect(result.current.storeInfo.phone).toBe('');
    expect(result.current.storeCode).toBe('');
  });

  it.each([
    ['an error reply', () => jsonResponse({ error: 'Store not found' }, 404), 'Store not found'],
    ['an empty error', () => new Response('', { status: 500 }), 'Failed to load store settings.'],
    [
      'a non-object body',
      () => jsonResponse('nope'),
      'Invalid response while loading store settings.',
    ],
  ])('shows a load failure from %s', async (_label, reply, message) => {
    stubFetch(reply);
    const { result } = await mount();
    expect(result.current.storeError).toBe(message);
  });

  it('validates before saving, and clears a field error when that field is edited', async () => {
    const calls = stubFetch(() => jsonResponse(stored));
    const { result } = await mount();
    act(() => {
      result.current.handleStoreInfoChange('name', '');
      result.current.handleStoreInfoChange('email', 'bad');
    });

    await act(() => result.current.handleStoreSubmit(submit()));
    expect(result.current.infoErrors).toEqual({
      name: 'Store name is required',
      email: 'Enter a valid email address',
    });
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0);

    act(() => result.current.handleStoreInfoChange('email', 'owner@shop.com'));
    expect(result.current.infoErrors).toEqual({ name: 'Store name is required' });
    // Editing a field with no error leaves the others alone.
    act(() => result.current.handleStoreInfoChange('city', 'Shelbyville'));
    expect(result.current.infoErrors).toEqual({ name: 'Store name is required' });
  });

  it('keeps only digits and a dash in the zip box', async () => {
    stubFetch(() => jsonResponse(stored));
    const { result } = await mount();
    act(() => result.current.handleZipcodeChange('ab12345-678999'));
    expect(result.current.storeInfo.zipcode).toBe('12345-6789');
  });

  it('saves store details, refreshes the signed-in user, and shows a passing success note', async () => {
    const calls = stubFetch((_url, method) =>
      method === 'PUT' ? jsonResponse({ ...stored, name: 'Corner Shop II' }) : jsonResponse(stored)
    );
    const { result } = await mount();
    act(() => result.current.handleStoreInfoChange('name', 'Corner Shop II'));
    vi.useFakeTimers();

    await act(() => result.current.handleStoreSubmit(submit()));

    expect(calls[1]).toMatchObject({ method: 'PUT', url: '/api/auth/store/settings' });
    expect(calls[1].body.name).toBe('Corner Shop II');
    expect(result.current.storeInfo.name).toBe('Corner Shop II');
    expect(auth.refreshUser).toHaveBeenCalled();
    expect(result.current.storeSuccess).toBe('Store information updated.');
    expect(result.current.storeSaving).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.storeSuccess).toBe('');
  });

  it('still reports success when only the user refresh fails', async () => {
    auth.refreshUser.mockRejectedValue(new Error('offline'));
    stubFetch(() => jsonResponse(stored));
    const { result } = await mount();
    await act(() => result.current.handleStoreSubmit(submit()));
    expect(result.current.storeSuccess).toBe('Store information updated.');
  });

  it("shows the server's reason when saving fails", async () => {
    stubFetch((_url, method) =>
      method === 'PUT'
        ? jsonResponse({ error: 'Unsupported image format. Use JPG, PNG, GIF, or WEBP.' }, 400)
        : jsonResponse(stored)
    );
    const { result } = await mount();
    await act(() => result.current.handleStoreSubmit(submit()));
    expect(result.current.storeError).toBe('Unsupported image format. Use JPG, PNG, GIF, or WEBP.');
    expect(result.current.storeSuccess).toBe('');
  });

  it('never saves store details for a taker', async () => {
    const calls = stubFetch(() => jsonResponse(stored));
    const { result } = await mount(true);
    await act(() => result.current.handleStoreSubmit(submit()));
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0);
  });

  it('changes the password, then clears the form', async () => {
    const calls = stubFetch(() => jsonResponse(stored));
    const { result } = await mount();
    act(() => {
      result.current.handlePasswordChange('current_password', 'Original1');
      result.current.handlePasswordChange('new_password', 'Changed22');
      result.current.handlePasswordChange('confirm_password', 'Changed22');
    });

    await act(() => result.current.handlePasswordSubmit(submit()));

    expect(calls[1]).toMatchObject({ method: 'PUT', url: '/api/auth/store/password' });
    // The confirmation box is checked here and never sent.
    expect(calls[1].body).toEqual({ current_password: 'Original1', new_password: 'Changed22' });
    expect(result.current.passwordSuccess).toBe('Password updated successfully.');
    expect(result.current.passwordForm).toEqual(settingsTypes.EMPTY_PASSWORD_FORM);
  });

  it('checks the new password before sending it, and shows a refusal', async () => {
    const calls = stubFetch((_url, method) =>
      method === 'PUT'
        ? jsonResponse({ error: 'Current password is incorrect' }, 401)
        : jsonResponse(stored)
    );
    const { result } = await mount();
    act(() => result.current.handlePasswordChange('new_password', 'weak'));
    await act(() => result.current.handlePasswordSubmit(submit()));
    expect(result.current.passwordError).toBe('Min 8 chars, 1 uppercase letter, 1 number');
    expect(calls).toHaveLength(1);

    act(() => {
      result.current.handlePasswordChange('new_password', 'Changed22');
      result.current.handlePasswordChange('confirm_password', 'Changed22');
    });
    await act(() => result.current.handlePasswordSubmit(submit()));
    expect(result.current.passwordError).toBe('Current password is incorrect');
    expect(result.current.passwordForm.new_password).toBe('Changed22');
  });

  function fileEvent(file: File | undefined) {
    const input = { files: file ? [file] : [], value: 'C:\\fakepath\\x' };
    return { event: { target: input } as unknown as ChangeEvent<HTMLInputElement>, input };
  }

  it('reads a chosen logo, and refuses formats the server cannot store', async () => {
    stubFetch(() => jsonResponse({ ...stored, logo: '' }));
    const { result } = await mount();

    const bad = fileEvent(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
    await act(() => result.current.handleLogoFileChange(bad.event));
    expect(result.current.storeError).toBe('Unsupported image format. Use JPG, PNG, GIF, or WEBP.');
    expect(bad.input.value).toBe('');

    const good = fileEvent(new File([new Uint8Array([1, 2])], 'logo.png', { type: 'image/png' }));
    await act(() => result.current.handleLogoFileChange(good.event));
    expect(result.current.storeError).toBe('');
    expect(result.current.storeInfo.logo).toMatch(/^data:image\/png;base64,/);

    act(() => result.current.removeLogo());
    expect(result.current.storeInfo.logo).toBe('');

    // A cancelled picker changes nothing.
    await act(() => result.current.handleLogoFileChange(fileEvent(undefined).event));
    expect(result.current.storeInfo.logo).toBe('');
  });

  it('shows, hides and copies the store code', async () => {
    stubFetch(() => jsonResponse(stored));
    const { result } = await mount();

    act(() => result.current.toggleCodeVisibility());
    expect(result.current.showCode).toBe(true);
    act(() => result.current.toggleCodeVisibility());
    expect(result.current.showCode).toBe(false);

    vi.useFakeTimers();
    await act(() => result.current.copyStoreCode());
    expect(clipboardWrite).toHaveBeenCalledWith('K7Q2XR');
    expect(result.current.codeCopied).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.codeCopied).toBe(false);

    clipboardWrite.mockRejectedValue(new Error('denied'));
    await act(() => result.current.copyStoreCode());
    expect(result.current.storeError).toBe('Could not copy store code.');
  });

  it('has nothing to copy before the code has loaded', async () => {
    stubFetch(() => jsonResponse({ name: 'Shop' }));
    const { result } = await mount();
    await act(() => result.current.copyStoreCode());
    expect(clipboardWrite).not.toHaveBeenCalled();
  });
});
