// @vitest-environment jsdom
/**
 * tests/client-gaps.test.tsx — the last untested corners of the browser code
 *
 *   - The zxing fallback scanner (phones without a native barcode detector) actually reading
 *     a barcode: an EAN-13 is drawn into a camera frame and must come back as its digits.
 *     tests/mobile-scanner-runtime.test.ts only ever fed it blank frames.
 *   - The Super Admin item detail, activity card and cross-store list hooks' failure paths.
 *   - Small shared helpers: toasts expiring, server timestamps, focus-on-mount.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
  BarcodeFormat,
  BrowserStoreBarcodeReader,
  DecodeHintType,
} from '../src/lib/zxingStoreScanner';
import { useAdminItemDetail } from '../src/hooks/useAdminItemDetail';
import { useAdminActivity } from '../src/hooks/useAdminActivity';
import { useAdminItemList } from '../src/hooks/useAdminItemList';
import { useToastState } from '../src/hooks/useToast';
import {
  focusOnMount,
  formatServerTime,
  parseServerDate,
  parseServerTimestamp,
} from '../src/lib/utils';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── zxing fallback scanner ───────────────────────────────────────────────────

/** EAN-13 module pattern: 95 bars, 1 = black. */
function ean13Modules(code: string): number[] {
  const L = [
    '0001101',
    '0011001',
    '0010011',
    '0111101',
    '0100011',
    '0110001',
    '0101111',
    '0111011',
    '0110111',
    '0001011',
  ];
  const G = [
    '0100111',
    '0110011',
    '0011011',
    '0100001',
    '0011101',
    '0111001',
    '0000101',
    '0010001',
    '0001001',
    '0010111',
  ];
  const R = [
    '1110010',
    '1100110',
    '1101100',
    '1000010',
    '1011100',
    '1001110',
    '1010000',
    '1000100',
    '1001000',
    '1110100',
  ];
  const parity = [
    'LLLLLL',
    'LLGLGG',
    'LLGGLG',
    'LLGGGL',
    'LGLLGG',
    'LGGLLG',
    'LGGGLL',
    'LGLGLG',
    'LGLGGL',
    'LGGLGL',
  ];
  const digits = [...code].map(Number);
  let bits = '101';
  digits.slice(1, 7).forEach((d, i) => {
    bits += parity[digits[0]][i] === 'L' ? L[d] : G[d];
  });
  bits += '01010';
  digits.slice(7).forEach(d => {
    bits += R[d];
  });
  bits += '101';
  return [...bits].map(Number);
}

/**
 * An RGBA frame with the barcode drawn across it. The quiet zone is left fully transparent,
 * which the reader must treat as white.
 */
function frameWithBarcode(
  code: string | null,
  moduleWidth = 3,
  quiet = 12,
  height = 40
): ImageData {
  const modules = code ? ean13Modules(code) : [];
  const width = (modules.length + quiet * 2) * moduleWidth || 120;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const m = Math.floor(x / moduleWidth) - quiet;
      const i = (y * width + x) * 4;
      if (m < 0 || m >= modules.length) continue; // transparent quiet zone
      const v = modules[m] ? 0 : 255;
      data.set([v, v, v, 255], i);
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

function cameraWith(frame: ImageData, options: { context?: boolean } = {}) {
  const trackStop = vi.fn();
  const stream = { getTracks: () => [{ stop: trackStop }] };
  const context = { drawImage: vi.fn(), getImageData: vi.fn(() => frame) };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => (options.context === false ? null : context)),
  };
  const video = {
    srcObject: null as unknown,
    playsInline: false,
    readyState: 4,
    videoWidth: frame.width,
    videoHeight: frame.height,
    play: vi.fn(async () => {}),
  };
  vi.spyOn(document, 'getElementById').mockImplementation(id =>
    id === 'reader' ? (video as never) : null
  );
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas' ? (canvas as never) : createElement(tag)) as typeof document.createElement);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });
  return { trackStop, video, canvas };
}

const hintsFor = (...formats: unknown[]) =>
  new Map<unknown, unknown>([[DecodeHintType.POSSIBLE_FORMATS, formats]]);

describe('BrowserStoreBarcodeReader', () => {
  it('reads an EAN-13 from a camera frame', async () => {
    const { trackStop, canvas } = cameraWith(frameWithBarcode('4006381333931'));
    const reader = new BrowserStoreBarcodeReader(
      hintsFor(BarcodeFormat.EAN_13, BarcodeFormat.UPC_A)
    );
    const callback = vi.fn();

    const controls = await reader.decodeFromConstraints({ video: true }, 'reader', callback);
    await waitFor(() => expect(callback).toHaveBeenCalled());

    const [result, error] = callback.mock.calls[0];
    expect(error).toBeNull();
    expect(result.getText()).toBe('4006381333931');
    // The canvas is sized to the video before drawing.
    expect(canvas.width).toBeGreaterThan(0);

    controls.stop();
    expect(trackStop).toHaveBeenCalledTimes(1);
  });

  it('reads a UPC-A with no format hints, as its 12 digits', async () => {
    // A UPC-A printed as EAN-13 has a leading 0, and is reported in its 12-digit form; the
    // server's upcVariants matches it against items saved in either form.
    cameraWith(frameWithBarcode('0036000291452'));
    const callback = vi.fn();
    await new BrowserStoreBarcodeReader().decodeFromConstraints(
      { video: true },
      'reader',
      callback
    );
    await waitFor(() => expect(callback).toHaveBeenCalled());
    expect(callback.mock.calls[0][0]?.getText()).toBe('036000291452');
  });

  it('does not read a retail barcode when only Code 39 and Code 128 are wanted', async () => {
    cameraWith(frameWithBarcode('4006381333931'));
    const hints = hintsFor(BarcodeFormat.CODE_39, BarcodeFormat.CODE_128);
    hints.set(DecodeHintType.ASSUME_CODE_39_CHECK_DIGIT, true);
    const callback = vi.fn();
    await new BrowserStoreBarcodeReader(hints).decodeFromConstraints(
      { video: true },
      'reader',
      callback
    );
    await waitFor(() => expect(callback).toHaveBeenCalled());
    expect(callback.mock.calls[0][0]).toBeNull();
    expect(callback.mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it('keeps scanning frame after frame until stopped', async () => {
    vi.useFakeTimers();
    cameraWith(frameWithBarcode(null));
    const callback = vi.fn();
    const controls = await new BrowserStoreBarcodeReader().decodeFromConstraints(
      { video: true },
      'reader',
      callback
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(150 * 3);
    expect(callback.mock.calls.length).toBeGreaterThanOrEqual(3);

    controls.stop();
    const calls = callback.mock.calls.length;
    await vi.advanceTimersByTimeAsync(150 * 5);
    expect(callback.mock.calls.length).toBe(calls);
  });

  it('waits for the video to have a frame before decoding', async () => {
    vi.useFakeTimers();
    const { video } = cameraWith(frameWithBarcode(null));
    video.readyState = 0;
    const callback = vi.fn();
    await new BrowserStoreBarcodeReader().decodeFromConstraints(
      { video: true },
      'reader',
      callback
    );
    await vi.advanceTimersByTimeAsync(150 * 3);
    expect(callback).not.toHaveBeenCalled();
  });

  it('fails clearly without the video element, or without a canvas to draw on', async () => {
    cameraWith(frameWithBarcode(null));
    await expect(
      new BrowserStoreBarcodeReader().decodeFromConstraints({ video: true }, 'missing', vi.fn())
    ).rejects.toThrow('Scanner video element not found.');

    const { trackStop } = cameraWith(frameWithBarcode(null), { context: false });
    await expect(
      new BrowserStoreBarcodeReader().decodeFromConstraints({ video: true }, 'reader', vi.fn())
    ).rejects.toThrow('Could not create scanner canvas context.');
    // The camera that was opened is released again.
    expect(trackStop).toHaveBeenCalledTimes(1);
  });

  it('stops the previous camera when started again, and on reset', async () => {
    const { trackStop } = cameraWith(frameWithBarcode(null));
    const reader = new BrowserStoreBarcodeReader();
    await reader.decodeFromConstraints({ video: true }, 'reader', vi.fn());
    await reader.decodeFromConstraints({ video: true }, 'reader', vi.fn());
    expect(trackStop).toHaveBeenCalledTimes(1);

    reader.reset();
    expect(trackStop).toHaveBeenCalledTimes(2);
    reader.reset();
    expect(trackStop).toHaveBeenCalledTimes(2);
  });
});

// ── Super Admin hooks ────────────────────────────────────────────────────────

function routed(entry = '/admin') {
  let location = '';
  const Probe = ({ children }: PropsWithChildren) => {
    const loc = useLocation();
    location = loc.pathname + loc.search;
    return <>{children}</>;
  };
  const wrapper = ({ children }: PropsWithChildren) => (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="*" element={<Probe>{children}</Probe>} />
      </Routes>
    </MemoryRouter>
  );
  return { wrapper, location: () => location };
}

function stubFetch(reply: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => reply(String(input), init));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('useAdminItemDetail', () => {
  const item = { id: 5, item_name: 'Cola', store_id: 2, revision: 'r1' };

  it('loads an item with the other stores that carry its UPC', async () => {
    stubFetch(() => Response.json({ item, other_stores: [{ item_id: 9, store_id: 3 }] }));
    const { wrapper } = routed();
    const { result } = renderHook(() => useAdminItemDetail('2', '5'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.item?.item_name).toBe('Cola');
    expect(result.current.otherStores).toHaveLength(1);
  });

  it("shows the server's reason, or a fallback, when the item cannot load", async () => {
    stubFetch(() => Response.json({ error: 'Item not found' }, { status: 404 }));
    const { wrapper } = routed();
    const missing = renderHook(() => useAdminItemDetail('2', '5'), { wrapper });
    await waitFor(() => expect(missing.result.current.error).toBe('Item not found'));
    expect(missing.result.current.item).toBeNull();
    cleanup();

    stubFetch(() => new Response('oops', { status: 500 }));
    const broken = renderHook(() => useAdminItemDetail('2', '5'), { wrapper: routed().wrapper });
    await waitFor(() => expect(broken.result.current.error).toBe('Failed to load item'));
  });

  it('sends a signed-out admin to login', async () => {
    stubFetch(() => new Response('', { status: 401 }));
    const { wrapper, location } = routed();
    renderHook(() => useAdminItemDetail('2', '5'), { wrapper });
    await waitFor(() => expect(location()).toBe('/login'));
  });

  it('asks for nothing without both ids, and reloads on request', async () => {
    const fetchMock = stubFetch(() => Response.json({ item, other_stores: [] }));
    const { wrapper } = routed();
    renderHook(() => useAdminItemDetail('2', undefined), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const { result } = renderHook(() => useAdminItemDetail('2', '5'), {
      wrapper: routed().wrapper,
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => result.current.reload());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('applies a saved edit only to the item still on screen', async () => {
    stubFetch(() => Response.json({ item, other_stores: [] }));
    const { result } = renderHook(() => useAdminItemDetail('2', '5'), {
      wrapper: routed().wrapper,
    });
    await waitFor(() => expect(result.current.item).not.toBeNull());

    act(() => result.current.applyEdit({ id: 6, item_name: 'Other' }, [{ item_id: 1 } as never]));
    expect(result.current.item?.item_name).toBe('Cola');

    act(() => result.current.applyEdit({ id: 5, item_name: 'Diet Cola' }, []));
    expect(result.current.item?.item_name).toBe('Diet Cola');
  });
});

describe('useAdminActivity', () => {
  it('loads the latest changes with the unseen count', async () => {
    stubFetch(() => Response.json({ items: [{ id: 1 }], total: 12, unseen: 3, newest: 40 }));
    const { result } = renderHook(() => useAdminActivity(), { wrapper: routed().wrapper });
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(result.current.total).toBe(12);
  });

  it('shows an empty card with the reason when loading fails', async () => {
    stubFetch(() => new Response('', { status: 500 }));
    const { result } = renderHook(() => useAdminActivity(), { wrapper: routed().wrapper });
    await waitFor(() => expect(result.current.error).toBe('Failed to load recent changes'));
    expect(result.current.entries).toEqual([]);
  });

  it('sends a signed-out admin to login', async () => {
    stubFetch(() => new Response('', { status: 401 }));
    const { wrapper, location } = routed();
    renderHook(() => useAdminActivity(), { wrapper });
    await waitFor(() => expect(location()).toBe('/login'));
  });
});

describe('useAdminItemList', () => {
  const options = {
    endpoint: '/api/admin/recent',
    filter: { name: 'days', value: '7' },
    failureText: 'Failed to load items',
  };

  it('keeps the chosen store in the URL and sends it with the filter', async () => {
    const fetchMock = stubFetch(() =>
      Response.json({ items: [{ id: 1 }], total: 1, period: 'week' })
    );
    const { wrapper, location } = routed('/admin/recent?store=4');
    const { result } = renderHook(() => useAdminItemList(options), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/recent?days=7&page=1&store=4');
    expect(result.current.storeId).toBe(4);
    // Anything beside the rows and total is passed through.
    expect(result.current.extra).toEqual({ period: 'week' });

    act(() => result.current.setStoreId(null));
    await waitFor(() => expect(location()).toBe('/admin/recent'));
  });

  it('ignores a store in the URL that is not a positive whole number', async () => {
    stubFetch(() => Response.json({ items: [], total: 0 }));
    const { result } = renderHook(() => useAdminItemList(options), {
      wrapper: routed('/admin/recent?store=0x4').wrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.storeId).toBeNull();
  });

  it("shows the server's reason, or the list's own fallback", async () => {
    stubFetch(() => Response.json({ error: 'Bad filter' }, { status: 400 }));
    const bad = renderHook(() => useAdminItemList(options), { wrapper: routed().wrapper });
    await waitFor(() => expect(bad.result.current.error).toBe('Bad filter'));
    cleanup();

    stubFetch(() => new Response('', { status: 500 }));
    const blank = renderHook(() => useAdminItemList(options), { wrapper: routed().wrapper });
    await waitFor(() => expect(blank.result.current.error).toBe('Failed to load items'));
    expect(blank.result.current.items).toEqual([]);
  });

  it('sends a signed-out admin to login', async () => {
    stubFetch(() => new Response('', { status: 401 }));
    const { wrapper, location } = routed();
    renderHook(() => useAdminItemList(options), { wrapper });
    await waitFor(() => expect(location()).toBe('/login'));
  });

  it('reloads on request, and logs out', async () => {
    const fetchMock = stubFetch(() => Response.json({ items: [], total: 0 }));
    const { wrapper, location } = routed();
    const { result } = renderHook(() => useAdminItemList(options), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => result.current.reload());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(() => result.current.handleLogout());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' })
    );
    expect(location()).toBe('/login');
  });
});

// ── Shared helpers ───────────────────────────────────────────────────────────

describe('useToastState', () => {
  it('shows each toast for three seconds, independently', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useToastState());

    act(() => result.current.addToast('success', 'Saved'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    act(() => result.current.addToast('error', 'Failed'));
    expect(result.current.toasts.map(t => t.message)).toEqual(['Saved', 'Failed']);
    expect(new Set(result.current.toasts.map(t => t.id)).size).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.toasts.map(t => t.message)).toEqual(['Failed']);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.toasts).toEqual([]);

    // Timers still pending on unmount are cleared, not fired into an unmounted hook.
    act(() => result.current.addToast('warning', 'Later'));
    unmount();
    await vi.advanceTimersByTimeAsync(5000);
  });
});

describe('server time helpers', () => {
  it('reads SQLite UTC text, ISO text, dates and epoch numbers', () => {
    const expected = Date.parse('2026-10-16T09:30:00Z');
    expect(parseServerTimestamp('2026-10-16 09:30:00')?.getTime()).toBe(expected);
    expect(parseServerTimestamp('2026-10-16T09:30:00')?.getTime()).toBe(expected);
    expect(parseServerTimestamp('2026-10-16T09:30:00Z')?.getTime()).toBe(expected);
    expect(parseServerTimestamp(new Date(expected))?.getTime()).toBe(expected);
    expect(parseServerTimestamp(expected)?.getTime()).toBe(expected);
    expect(parseServerTimestamp('not a date')).toBeNull();
    expect(parseServerTimestamp(null)).toBeNull();
  });

  it('falls back to now for an unreadable value, and formats a time of day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
    expect(parseServerDate('garbage').getTime()).toBe(Date.parse('2026-10-16T12:00:00Z'));
    expect(formatServerTime('2026-10-16 09:30:00')).toMatch(/\d{1,2}:30/);
  });

  it('focuses an element when it mounts, and ignores none', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    focusOnMount(input);
    expect(document.activeElement).toBe(input);
    expect(() => focusOnMount(null)).not.toThrow();
    input.remove();
  });
});
