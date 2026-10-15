// @vitest-environment jsdom
/**
 * tests/scan-hooks.test.tsx — the phone scan hook and the hardware scanner hook, mounted
 *
 * tests/scan-helpers.test.ts covers the pure helpers these hooks are built from. This file
 * covers the wiring between them: what the phone sends when it syncs and scans, how it
 * reacts to the server's answers, and what a keyboard-wedge burst does on the desktop.
 *
 * The camera itself is not exercised: jsdom is not a secure context, so the hook reports
 * that the camera is unavailable and stays on manual entry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useMobileScan } from '../src/hooks/useMobileScan';
import { useHardwareScanner } from '../src/hooks/useHardwareScanner';

const SESSION_ID = 'hook-session';
const OTP = 'ABCD2345';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const cola = {
  id: 1,
  product_name: 'Existing Cola',
  upc: '111222333444',
  unit: 'can',
  quantity: 2,
  scanned_at: '2026-10-13 10:00:00',
};

type FetchCall = { url: string; init?: RequestInit };

/** Stubs fetch with separate answers for the phone's sync (GET) and scan (POST). */
function stubScanApi(options: {
  sync?: () => Response | Promise<Response>;
  scan?: () => Response | Promise<Response>;
}) {
  const calls: FetchCall[] = [];
  const sync = options.sync ?? (() => jsonResponse({ status: 'active', items: [cola] }));
  const scan = options.scan ?? (() => jsonResponse({ item: { ...cola, id: 2 } }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init });
      return init?.method === 'POST' ? scan() : sync();
    })
  );
  return {
    syncs: () => calls.filter(call => call.init?.method !== 'POST'),
    scans: () => calls.filter(call => call.init?.method === 'POST'),
  };
}

const submitEvent = () => ({ preventDefault: () => {} }) as FormEvent<HTMLFormElement>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // The hook logs the failures these tests provoke on purpose.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useMobileScan', () => {
  const mount = (otp: string | null = OTP) =>
    renderHook(() => useMobileScan({ sessionId: SESSION_ID, otp }));

  it('syncs with the OTP and device ID in headers, never in the URL', async () => {
    const api = stubScanApi({});
    const { result } = mount();

    await waitFor(() => expect(result.current.sessionStatus).toBe('active'));
    expect(result.current.scannedItems.map(item => item.name)).toEqual(['Existing Cola']);
    expect(result.current.scanCount).toBe(2);
    expect(result.current.isConnected).toBe(true);

    const [first] = api.syncs();
    expect(first.url).toBe(`/api/session/${SESSION_ID}/items`);
    const headers = first.init?.headers as Record<string, string>;
    expect(headers['X-Scan-Otp']).toBe(OTP);
    expect(headers['X-Device-Id']).toBe(localStorage.getItem('scan_device_id'));
    expect(headers['X-Device-Id']).toBeTruthy();
  });

  it('asks for nothing until it has an OTP', async () => {
    const api = stubScanApi({});
    const { result } = mount(null);

    await act(async () => {
      await Promise.resolve();
    });
    expect(api.syncs()).toHaveLength(0);
    expect(result.current.sessionStatus).toBeNull();
  });

  it('syncs again every three seconds', async () => {
    vi.useFakeTimers();
    const api = stubScanApi({});
    mount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.syncs()).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(api.syncs()).toHaveLength(2);
  });

  it('stops with the server message when the session or OTP is refused', async () => {
    stubScanApi({ sync: () => jsonResponse({ error: 'Invalid session or OTP' }, 403) });
    const { result } = mount();

    await waitFor(() => expect(result.current.cameraError).toBe('Invalid session or OTP'));
    expect(result.current.toast).toEqual({ type: 'error', message: 'Invalid session or OTP' });
    // A refusal is an answer, not a dropped connection.
    expect(result.current.isConnected).toBe(true);
  });

  it('shows as disconnected when the network drops, until a retry is asked for', async () => {
    stubScanApi({
      sync: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const { result } = mount();

    await waitFor(() => expect(result.current.isConnected).toBe(false));
    expect(result.current.reconnectAttempts).toBe(1);

    act(() => result.current.retryConnection());
    expect(result.current.isConnected).toBe(true);
    expect(result.current.reconnectAttempts).toBe(0);
  });

  it('submits a manual scan with the OTP, name and a scan ID, then clears the form', async () => {
    const api = stubScanApi({
      scan: () =>
        jsonResponse({
          item: { id: 2, product_name: 'Manual Seltzer', upc: '222333444555', quantity: 1 },
        }),
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.sessionStatus).toBe('active'));

    act(() => {
      result.current.setManualInput(' 222333444555 ');
      result.current.setManualItemName('Manual Seltzer');
    });
    await act(async () => {
      await result.current.handleManualSubmit(submitEvent());
    });

    const [post] = api.scans();
    expect(post.url).toBe(`/api/session/${SESSION_ID}/scan`);
    const body = JSON.parse(String(post.init?.body));
    expect(body).toMatchObject({ upc: '222333444555', otp: OTP, item_name: 'Manual Seltzer' });
    expect(body.scan_id).toBeTruthy();
    expect((post.init?.headers as Record<string, string>)['X-Device-Id']).toBeTruthy();

    expect(result.current.scannedItems.map(item => item.name)).toEqual([
      'Manual Seltzer',
      'Existing Cola',
    ]);
    expect(result.current.scanCount).toBe(3);
    expect(result.current.manualInput).toBe('');
    expect(result.current.manualItemName).toBe('');
    expect(result.current.toast).toEqual({ type: 'success', message: 'Manual Seltzer' });
    expect(result.current.isProcessing).toBe(false);
  });

  it('keeps the form and shows the server message when a scan is rejected', async () => {
    const api = stubScanApi({
      scan: () => jsonResponse({ error: 'Session has expired' }, 410),
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.sessionStatus).toBe('active'));

    act(() => result.current.setManualInput('222333444555'));
    await act(async () => {
      await result.current.handleManualSubmit(submitEvent());
    });

    expect(api.scans()).toHaveLength(1);
    expect(result.current.toast).toEqual({ type: 'error', message: 'Session has expired' });
    expect(result.current.manualInput).toBe('222333444555');
    expect(result.current.scannedItems).toHaveLength(1);
    expect(result.current.isProcessing).toBe(false);
  });

  it('sends nothing while the session is a draft', async () => {
    const api = stubScanApi({ sync: () => jsonResponse({ status: 'draft', items: [cola] }) });
    const { result } = mount();
    await waitFor(() => expect(result.current.sessionStatus).toBe('draft'));

    act(() => result.current.setManualInput('222333444555'));
    await act(async () => {
      await result.current.handleManualSubmit(submitEvent());
    });

    expect(api.scans()).toHaveLength(0);
    expect(result.current.toast).toEqual({
      type: 'error',
      message: 'Scanning is paused for this session.',
    });
  });

  it('retries a scan the network dropped with the same scan ID, then reports the failure', async () => {
    vi.useFakeTimers();
    const api = stubScanApi({
      scan: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const { result } = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.sessionStatus).toBe('active');

    act(() => result.current.setManualInput('222333444555'));
    let submitted: Promise<void>;
    act(() => {
      submitted = result.current.handleManualSubmit(submitEvent());
    });
    // Two retries, 600 ms then 1200 ms after the first attempt.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
      await submitted;
    });

    const scanIds = api.scans().map(call => JSON.parse(String(call.init?.body)).scan_id);
    expect(scanIds).toHaveLength(3);
    expect(new Set(scanIds).size).toBe(1);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.toast).toEqual({
      type: 'error',
      message: 'Network error while submitting scan',
    });
    expect(result.current.manualInput).toBe('222333444555');
  });
});

describe('useHardwareScanner', () => {
  const type = (text: string) => {
    for (const key of text) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
  };
  const enter = () => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    return event;
  };

  function mount(status: 'active' | 'draft' = 'active') {
    const addToast = vi.fn();
    const hook = renderHook(() => useHardwareScanner(SESSION_ID, OTP, status, 'ready', addToast));
    return { ...hook, addToast };
  }

  it('ignores the keyboard until hardware mode is chosen, and remembers the choice', async () => {
    const api = stubScanApi({});
    const { result } = mount();

    expect(result.current.scanInputMode).toBe('mobile');
    type('012345678905');
    enter();
    expect(api.scans()).toHaveLength(0);

    act(() => result.current.setScanInputMode('hardware'));
    expect(sessionStorage.getItem('scan_input_mode')).toBe('hardware');
  });

  it('submits a scanner burst ending in Enter and reports it', async () => {
    const api = stubScanApi({ scan: () => jsonResponse({ item: cola }) });
    const { result, addToast } = mount();
    act(() => result.current.setScanInputMode('hardware'));

    type('012345678905');
    let event: KeyboardEvent;
    act(() => {
      event = enter();
    });

    await waitFor(() => expect(addToast).toHaveBeenCalledWith('success', 'Scanned: 012345678905'));
    // Enter must not also submit whatever form or button has focus.
    expect(event!.defaultPrevented).toBe(true);
    expect(result.current.lastHardwareScan).toBe('012345678905');
    const [post] = api.scans();
    expect(post.url).toBe(`/api/session/${SESSION_ID}/scan`);
    expect(JSON.parse(String(post.init?.body))).toEqual({
      upc: '012345678905',
      otp: OTP,
      // One ID per trigger pull, so a retried request counts once.
      scan_id: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/),
    });
  });

  it('leaves typing in a text box alone', async () => {
    const api = stubScanApi({});
    const { result } = mount();
    act(() => result.current.setScanInputMode('hardware'));

    const input = document.createElement('input');
    document.body.appendChild(input);
    for (const key of '012345678905') {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.remove();

    expect(api.scans()).toHaveLength(0);
    expect(result.current.lastHardwareScan).toBeNull();
  });

  it('reports a scan the server refuses', async () => {
    stubScanApi({ scan: () => jsonResponse({ error: 'Session is saved as draft.' }, 403) });
    const { result, addToast } = mount();
    act(() => result.current.setScanInputMode('hardware'));

    type('012345678905');
    act(() => {
      enter();
    });

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        'error',
        'Failed to record scan for 012345678905: Session is saved as draft.'
      )
    );
  });

  it('does not listen while the session is a draft', async () => {
    const api = stubScanApi({});
    const { result } = mount('draft');
    act(() => result.current.setScanInputMode('hardware'));

    type('012345678905');
    enter();
    expect(api.scans()).toHaveLength(0);
  });
});
