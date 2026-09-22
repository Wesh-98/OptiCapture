import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadScannerModule() {
  vi.resetModules();
  return import('../src/lib/mobileScanScanner.js');
}

describe('mobile scanner runtime', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.doUnmock('../src/lib/zxingStoreScanner.js');
  });

  it('returns null when native barcode detection is unavailable', async () => {
    const { startNativeScanner } = await loadScannerModule();

    const controls = await startNativeScanner({
      scannerElementId: 'mobile-reader',
      isProcessing: () => false,
      onDetected: async () => {},
    });

    expect(controls).toBeNull();
  });

  it('returns null when the browser supports no matching barcode formats', async () => {
    class MockBarcodeDetector {
      static getSupportedFormats = vi.fn().mockResolvedValue(['qr_code']);
      detect = vi.fn();
    }

    vi.stubGlobal('BarcodeDetector', MockBarcodeDetector);

    const { startNativeScanner } = await loadScannerModule();
    const controls = await startNativeScanner({
      scannerElementId: 'mobile-reader',
      isProcessing: () => false,
      onDetected: async () => {},
    });

    expect(controls).toBeNull();
    expect(MockBarcodeDetector.getSupportedFormats).toHaveBeenCalledTimes(1);
  });

  it('uses native detection when available and stops the stream cleanly', async () => {
    vi.useFakeTimers();

    const onDetected = vi.fn(async () => {});
    const onUndetected = vi.fn();
    const trackStop = vi.fn();
    const video = {
      srcObject: null as unknown,
      readyState: 2,
      play: vi.fn().mockResolvedValue(undefined),
    };
    const stream = {
      getTracks: () => [{ stop: trackStop }],
    };
    const detect = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ rawValue: ' 012345678905 ' }]);

    let formatsUsed: string[] | undefined;

    class MockBarcodeDetector {
      static getSupportedFormats = vi.fn().mockResolvedValue(['ean_13', 'upc_a']);

      constructor(options?: { formats?: string[] }) {
        formatsUsed = options?.formats;
      }

      detect = detect;
    }

    vi.stubGlobal('BarcodeDetector', MockBarcodeDetector);
    vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 });
    vi.stubGlobal('document', {
      getElementById: (id: string) => (id === 'mobile-reader' ? video : null),
    });
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(stream),
      },
    });

    const { startNativeScanner } = await loadScannerModule();
    const controls = await startNativeScanner({
      scannerElementId: 'mobile-reader',
      isProcessing: () => false,
      onDetected,
      onUndetected,
    });

    expect(controls).not.toBeNull();
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBe(stream);
    expect(formatsUsed).toEqual(['upc_a', 'ean_13']);

    await vi.advanceTimersByTimeAsync(120);
    expect(onUndetected).toHaveBeenCalledTimes(1);
    expect(onDetected).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(120);
    expect(onDetected).toHaveBeenCalledWith('012345678905');

    await controls?.stop();

    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
  });

  it('cleans up native camera streams when startup fails after access is granted', async () => {
    const trackStop = vi.fn();
    const video = {
      srcObject: null as unknown,
      readyState: 2,
      play: vi.fn().mockRejectedValue(new Error('play failed')),
    };
    const stream = {
      getTracks: () => [{ stop: trackStop }],
    };

    class MockBarcodeDetector {
      detect = vi.fn();
    }

    vi.stubGlobal('BarcodeDetector', MockBarcodeDetector);
    vi.stubGlobal('document', {
      getElementById: (id: string) => (id === 'mobile-reader' ? video : null),
    });
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(stream),
      },
    });

    const { startNativeScanner } = await loadScannerModule();

    await expect(
      startNativeScanner({
        scannerElementId: 'mobile-reader',
        isProcessing: () => false,
        onDetected: async () => {},
      })
    ).rejects.toThrow('play failed');

    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
  });

  it('uses the ZXing fallback callbacks and configured reader hints', async () => {
    const controls = { stop: vi.fn() };
    const onDetected = vi.fn(async () => {});
    const onUndetected = vi.fn();
    let capturedHints: Map<unknown, unknown> | undefined;

    vi.doMock('../src/lib/zxingStoreScanner.js', () => ({
      BrowserStoreBarcodeReader: class MockReader {
        constructor(hints?: Map<unknown, unknown>) {
          capturedHints = hints;
        }

        reset = vi.fn();

        decodeFromConstraints = vi.fn(async (_constraints, _scannerElementId, callback) => {
          await callback({ getText: () => '987654321098' }, null);
          await callback(null, new Error('not found'));
          return controls;
        });
      },
      BarcodeFormat: {
        UPC_A: 'UPC_A',
        UPC_E: 'UPC_E',
        EAN_13: 'EAN_13',
        EAN_8: 'EAN_8',
        CODE_128: 'CODE_128',
        CODE_39: 'CODE_39',
      },
      DecodeHintType: {
        TRY_HARDER: 'TRY_HARDER',
        POSSIBLE_FORMATS: 'POSSIBLE_FORMATS',
      },
    }));

    const { startFallbackScanner } = await loadScannerModule();
    const result = await startFallbackScanner({
      scannerElementId: 'mobile-reader',
      isProcessing: () => false,
      onDetected,
      onUndetected,
    });

    expect(result.controls).toBe(controls);
    expect(onDetected).toHaveBeenCalledWith('987654321098');
    expect(onUndetected).toHaveBeenCalledTimes(1);
    expect(capturedHints?.get('TRY_HARDER')).toBe(true);
    expect(capturedHints?.get('POSSIBLE_FORMATS')).toEqual([
      'UPC_A',
      'UPC_E',
      'EAN_13',
      'EAN_8',
      'CODE_128',
      'CODE_39',
    ]);
  });

  it('resets the fallback reader and clears the video element when startup fails', async () => {
    const video = { srcObject: { stream: true } };
    const reset = vi.fn();

    vi.stubGlobal('document', {
      getElementById: (id: string) => (id === 'mobile-reader' ? video : null),
    });

    vi.doMock('../src/lib/zxingStoreScanner.js', () => ({
      BrowserStoreBarcodeReader: class MockReader {
        constructor() {}

        reset = reset;

        decodeFromConstraints = vi.fn().mockRejectedValue(new Error('decode failed'));
      },
      BarcodeFormat: {
        UPC_A: 'UPC_A',
        UPC_E: 'UPC_E',
        EAN_13: 'EAN_13',
        EAN_8: 'EAN_8',
        CODE_128: 'CODE_128',
        CODE_39: 'CODE_39',
      },
      DecodeHintType: {
        TRY_HARDER: 'TRY_HARDER',
        POSSIBLE_FORMATS: 'POSSIBLE_FORMATS',
      },
    }));

    const { startFallbackScanner } = await loadScannerModule();

    await expect(
      startFallbackScanner({
        scannerElementId: 'mobile-reader',
        isProcessing: () => false,
        onDetected: async () => {},
      })
    ).rejects.toThrow('decode failed');

    expect(reset).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
  });

  it('releases the fallback camera stream when video startup fails', async () => {
    const trackStop = vi.fn();
    const stream = { getTracks: () => [{ stop: trackStop }] };
    const video = {
      srcObject: null as unknown,
      playsInline: false,
      play: vi.fn().mockRejectedValue(new Error('video failed')),
    };

    vi.stubGlobal('document', {
      getElementById: (id: string) => (id === 'mobile-reader' ? video : null),
    });
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    const { BrowserStoreBarcodeReader } = await import('../src/lib/zxingStoreScanner.js');
    const reader = new BrowserStoreBarcodeReader();

    await expect(
      reader.decodeFromConstraints({ video: true }, 'mobile-reader', () => {})
    ).rejects.toThrow('video failed');

    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
  });

  it('decodes fallback frames on an interval and stops all resources', async () => {
    const trackStop = vi.fn();
    const stream = { getTracks: () => [{ stop: trackStop }] };
    const imageData = {
      data: new Uint8ClampedArray(10 * 10 * 4).fill(255),
      width: 10,
      height: 10,
    } as ImageData;
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue(imageData),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(context),
    };
    const video = {
      srcObject: null as unknown,
      playsInline: false,
      readyState: 2,
      videoWidth: 10,
      videoHeight: 10,
      play: vi.fn().mockResolvedValue(undefined),
    };
    const callback = vi.fn();

    vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 });
    vi.stubGlobal('document', {
      getElementById: (id: string) => (id === 'mobile-reader' ? video : null),
      createElement: (tag: string) => (tag === 'canvas' ? canvas : null),
    });
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    const { BrowserStoreBarcodeReader } = await import('../src/lib/zxingStoreScanner.js');
    const reader = new BrowserStoreBarcodeReader();
    const controls = await reader.decodeFromConstraints(
      { video: true },
      'mobile-reader',
      callback
    );

    await vi.waitFor(() => expect(callback).toHaveBeenCalled());
    expect(callback.mock.calls[0][0]).toBeNull();
    expect(callback.mock.calls[0][1]).toBeInstanceOf(Error);
    expect(context.drawImage).toHaveBeenCalledTimes(1);

    await controls.stop();
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
  });
});
