// @vitest-environment jsdom
/**
 * tests/mobile-scan-camera.test.tsx — the phone's camera path in useMobileScan
 *
 * tests/scan-hooks.test.tsx covers syncing and manual entry, and stays on manual entry
 * because jsdom has no camera. This file stands the camera library in with a fake so the
 * hook's own decisions can be checked: when the camera starts and with which scanner, what
 * a detected barcode does (and that a barcode held in front of the lens counts once), the
 * error messages a store worker sees, the 60-second idle shut-off, and that every way of
 * leaving releases the camera.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

type StartOptions = {
  scannerElementId: string;
  isProcessing: () => boolean;
  onDetected: (code: string) => Promise<void> | void;
  onUndetected: () => void;
};

const scanner = vi.hoisted(() => ({
  startNativeScanner: vi.fn(),
  startFallbackScanner: vi.fn(),
  stopScannerResources: vi.fn(async () => {}),
}));

vi.mock('../src/lib/mobileScanScanner', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/lib/mobileScanScanner')>()),
  ...scanner,
}));

const { useMobileScan } = await import('../src/hooks/useMobileScan');
const { MOBILE_SCAN_IDLE_TIMEOUT_MS } = await import('../src/lib/mobileScanScanner');

const SESSION_ID = 'camera-session';
const OTP = 'ABCD2345';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let sessionStatus = 'active';
let scanBodies: any[] = [];
let scanReply: () => Response = () =>
  jsonResponse({ item: { id: 9, product_name: 'Cola', upc: '012345678905', quantity: 1 } });

const nativeControls = () => ({ stop: vi.fn() });

/** Flush pending promises and advance the fake clock inside React's act(). */
async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** The callbacks the hook handed the most recent scanner start. */
function lastStart(): StartOptions {
  const calls = [
    ...scanner.startNativeScanner.mock.calls,
    ...scanner.startFallbackScanner.mock.calls,
  ];
  return calls.at(-1)![0] as StartOptions;
}

async function mount() {
  const hook = renderHook(() => useMobileScan({ sessionId: SESSION_ID, otp: OTP }));
  await advance();
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStatus = 'active';
  scanBodies = [];
  scanReply = () =>
    jsonResponse({ item: { id: 9, product_name: 'Cola', upc: '012345678905', quantity: 1 } });
  scanner.startNativeScanner.mockReset().mockImplementation(async () => nativeControls());
  scanner.startFallbackScanner.mockReset();
  scanner.stopScannerResources.mockReset().mockImplementation(async () => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vi.fn() });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        scanBodies.push(JSON.parse(String(init.body)));
        return scanReply();
      }
      return jsonResponse({ status: sessionStatus, items: [] });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useMobileScan — starting the camera', () => {
  it('starts the native scanner once the session is known to be active', async () => {
    const { result } = await mount();

    expect(scanner.startNativeScanner).toHaveBeenCalledTimes(1);
    expect(lastStart().scannerElementId).toBe(result.current.scannerElementId);
    expect(scanner.startFallbackScanner).not.toHaveBeenCalled();
    expect(result.current.cameraError).toBeNull();
    expect(result.current.inputMode).toBe('camera');
  });

  it('falls back to the zxing scanner where the browser has no native detector', async () => {
    scanner.startNativeScanner.mockImplementation(async () => null);
    scanner.startFallbackScanner.mockImplementation(async () => ({
      controls: nativeControls(),
      reader: { reset: vi.fn() },
    }));

    await mount();

    expect(scanner.startFallbackScanner).toHaveBeenCalledTimes(1);
  });

  it('does not open the camera for a draft session', async () => {
    sessionStatus = 'draft';
    await mount();
    expect(scanner.startNativeScanner).not.toHaveBeenCalled();
  });

  it('asks for HTTPS instead of opening the camera on an insecure page', async () => {
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false });
    const { result } = await mount();

    expect(result.current.cameraError).toBe(
      'Camera requires HTTPS. Open the tunnel URL, not the LAN IP.'
    );
    expect(scanner.startNativeScanner).not.toHaveBeenCalled();
  });

  it.each([
    [
      'NotAllowedError',
      'Camera permission denied. Tap the address bar lock icon and allow camera access.',
    ],
    ['NotFoundError', 'No camera found on this device.'],
    ['NotReadableError', 'Camera is in use by another app. Close it and try again.'],
  ])('explains a %s from the camera', async (name, message) => {
    scanner.startNativeScanner.mockImplementation(async () => {
      throw Object.assign(new Error('x'), { name });
    });
    const { result } = await mount();

    expect(result.current.cameraError).toBe(message);
    // An error is not retried in a loop.
    await advance(10_000);
    expect(scanner.startNativeScanner).toHaveBeenCalledTimes(1);
  });

  it('tries again after the worker taps reset', async () => {
    scanner.startNativeScanner.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { name: 'NotReadableError' });
    });
    const { result } = await mount();
    expect(result.current.cameraError).not.toBeNull();

    let reset!: Promise<void>;
    act(() => {
      reset = result.current.handleResetCamera();
    });
    await advance(300);
    await act(() => reset);

    expect(result.current.cameraError).toBeNull();
    expect(scanner.startNativeScanner).toHaveBeenCalledTimes(2);
  });

  it('releases a camera that finished starting after the worker switched to manual entry', async () => {
    let finishStart!: (controls: unknown) => void;
    scanner.startNativeScanner.mockImplementation(
      () =>
        new Promise(resolve => {
          finishStart = resolve;
        })
    );
    const { result } = await mount();

    act(() => result.current.setInputMode('manual'));
    await advance();
    const late = nativeControls();
    await act(async () => {
      finishStart(late);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(scanner.stopScannerResources).toHaveBeenCalledWith(
      result.current.scannerElementId,
      late,
      null
    );
  });

  it('releases a fallback camera that finished starting too late', async () => {
    scanner.startNativeScanner.mockImplementation(async () => null);
    let finishStart!: (value: unknown) => void;
    scanner.startFallbackScanner.mockImplementation(
      () =>
        new Promise(resolve => {
          finishStart = resolve;
        })
    );
    const { result } = await mount();

    act(() => result.current.setInputMode('manual'));
    await advance();
    const late = { controls: nativeControls(), reader: { reset: vi.fn() } };
    await act(async () => {
      finishStart(late);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(scanner.stopScannerResources).toHaveBeenCalledWith(
      result.current.scannerElementId,
      late.controls,
      late.reader
    );
  });

  it('stops the camera when switching to manual entry, and on leaving the page', async () => {
    const controls = nativeControls();
    scanner.startNativeScanner.mockImplementation(async () => controls);
    const { result, unmount } = await mount();

    act(() => result.current.setInputMode('manual'));
    await advance();
    expect(scanner.stopScannerResources).toHaveBeenCalledWith(
      result.current.scannerElementId,
      controls,
      null
    );

    act(() => result.current.setInputMode('camera'));
    await advance();
    expect(scanner.startNativeScanner).toHaveBeenCalledTimes(2);

    const stopsBefore = scanner.stopScannerResources.mock.calls.length;
    unmount();
    await advance();
    expect(scanner.stopScannerResources.mock.calls.length).toBeGreaterThan(stopsBefore);
  });
});

describe('useMobileScan — detected barcodes', () => {
  it('sends a detected barcode, confirms it with a buzz, and lists it', async () => {
    const { result } = await mount();

    await act(async () => {
      await lastStart().onDetected(' 012345678905 ');
    });

    expect(scanBodies).toHaveLength(1);
    expect(scanBodies[0]).toMatchObject({ upc: '012345678905', otp: OTP });
    expect(scanBodies[0].item_name).toBeUndefined();
    expect(navigator.vibrate).toHaveBeenCalledWith([100, 50, 100]);
    expect(result.current.scannedItems.map(i => i.name)).toEqual(['Cola']);
    expect(result.current.toast).toEqual({ type: 'success', message: 'Cola' });
    expect(result.current.isProcessing).toBe(false);

    // The confirmation clears itself.
    await advance(3000);
    expect(result.current.toast).toBeNull();
  });

  it('counts a barcode held in front of the lens once, until it leaves the frame', async () => {
    await mount();
    const { onDetected, onUndetected } = lastStart();

    await act(async () => {
      await onDetected('012345678905');
      await onDetected('012345678905');
      await onDetected('012345678905');
    });
    expect(scanBodies).toHaveLength(1);

    // A different product is accepted straight away.
    await act(async () => {
      await onDetected('036000291452');
    });
    expect(scanBodies).toHaveLength(2);

    // After three empty frames the first product can be scanned again.
    act(() => {
      onUndetected();
      onUndetected();
    });
    await act(async () => {
      await onDetected('036000291452');
    });
    expect(scanBodies).toHaveLength(2);
    act(() => onUndetected());
    await act(async () => {
      await onDetected('036000291452');
    });
    expect(scanBodies).toHaveLength(3);
  });

  it('ignores blank reads and reads that arrive while a scan is being sent', async () => {
    let release!: (r: Response) => void;
    scanReply = () => jsonResponse({});
    const { result } = await mount();
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          release = resolve;
        })
    );
    const { onDetected, isProcessing } = lastStart();

    await act(async () => {
      await onDetected('   ');
    });
    expect(result.current.isProcessing).toBe(false);

    let first!: Promise<void> | void;
    act(() => {
      first = onDetected('012345678905');
    });
    expect(isProcessing()).toBe(true);
    expect(result.current.isProcessing).toBe(true);
    await act(async () => {
      await onDetected('036000291452');
    });

    await act(async () => {
      release(jsonResponse({ item: { id: 1, product_name: 'Cola', upc: '012345678905' } }));
      await first;
    });
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(
      1
    );
    expect(isProcessing()).toBe(false);
  });

  it("shows the server's reason when a camera scan is refused", async () => {
    scanReply = () => jsonResponse({ error: 'Session has expired' }, 410);
    const { result } = await mount();

    await act(async () => {
      await lastStart().onDetected('012345678905');
    });

    expect(result.current.toast).toEqual({ type: 'error', message: 'Session has expired' });
    expect(result.current.scannedItems).toEqual([]);
    expect(navigator.vibrate).not.toHaveBeenCalled();
  });

  it('lists a scan by its barcode when the server does not echo the item', async () => {
    scanReply = () => new Response('', { status: 200 });
    const { result } = await mount();

    await act(async () => {
      await lastStart().onDetected('012345678905');
    });

    expect(result.current.scannedItems.map(i => [i.name, i.upc])).toEqual([
      ['012345678905', '012345678905'],
    ]);
  });
});

describe('useMobileScan — idle shut-off', () => {
  it('counts down and switches the camera off after a minute without scans', async () => {
    const controls = nativeControls();
    scanner.startNativeScanner.mockImplementation(async () => controls);
    const { result } = await mount();
    expect(result.current.idleProgress).toBe(1);

    await advance(MOBILE_SCAN_IDLE_TIMEOUT_MS / 2);
    expect(result.current.idleProgress).toBeGreaterThan(0.4);
    expect(result.current.idleProgress).toBeLessThan(0.6);
    expect(result.current.cameraIdle).toBe(false);

    await advance(MOBILE_SCAN_IDLE_TIMEOUT_MS / 2 + 500);
    expect(result.current.cameraIdle).toBe(true);
    expect(result.current.idleProgress).toBe(0);
    expect(scanner.stopScannerResources).toHaveBeenCalledWith(
      result.current.scannerElementId,
      controls,
      null
    );
  });

  it('restarts the countdown on every scan', async () => {
    const { result } = await mount();

    await advance(MOBILE_SCAN_IDLE_TIMEOUT_MS - 5000);
    await act(async () => {
      await lastStart().onDetected('012345678905');
    });
    await advance(10_000);

    expect(result.current.cameraIdle).toBe(false);
  });

  it('turns the camera back on when the worker taps resume', async () => {
    const { result } = await mount();
    await advance(MOBILE_SCAN_IDLE_TIMEOUT_MS + 500);
    expect(result.current.cameraIdle).toBe(true);

    await act(async () => {
      await result.current.handleResumeCamera();
    });
    await advance();

    expect(result.current.cameraIdle).toBe(false);
    expect(result.current.idleProgress).toBe(1);
    expect(scanner.startNativeScanner.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not count down in manual entry', async () => {
    const { result } = await mount();
    act(() => result.current.setInputMode('manual'));
    await advance(MOBILE_SCAN_IDLE_TIMEOUT_MS * 2);
    expect(result.current.cameraIdle).toBe(false);
  });
});

describe('useMobileScan — session sync edge cases', () => {
  it('treats a sync answer without an item list as broken', async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ status: 'active' }));
    const { result } = await mount();

    expect(result.current.cameraError).toBe('Invalid session response.');
    expect(result.current.toast).toEqual({ type: 'error', message: 'Invalid session response.' });
  });

  it('shows as disconnected on a server error, and toasts only on the first one', async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ error: 'x' }, 503));
    const { result } = await mount();

    expect(result.current.isConnected).toBe(false);
    expect(result.current.reconnectAttempts).toBe(1);
    expect(result.current.toast).toEqual({
      type: 'error',
      message: 'Could not refresh scan session.',
    });

    await advance(3000);
    expect(result.current.reconnectAttempts).toBe(2);
  });

  it('reconnects on the next good sync', async () => {
    let down = true;
    vi.mocked(fetch).mockImplementation(async () =>
      down ? jsonResponse({}, 503) : jsonResponse({ status: 'active', items: [] })
    );
    const { result } = await mount();
    expect(result.current.isConnected).toBe(false);

    down = false;
    await advance(3000);
    expect(result.current.isConnected).toBe(true);
    expect(result.current.reconnectAttempts).toBe(0);
  });
});
