export const MOBILE_SCAN_ELEMENT_ID = 'mobile-reader';
export const MOBILE_SCAN_IDLE_TIMEOUT_MS = 60_000;

const NATIVE_SCAN_INTERVAL_MS = 120;
const NATIVE_BARCODE_FORMATS = [
  'upc_a',
  'upc_e',
  'ean_13',
  'ean_8',
  'code_128',
  'code_39',
] as const;

type ScannerStringConstraint = string | { ideal?: string; exact?: string };
type ScannerNumberConstraint =
  | number
  | { ideal?: number; min?: number; max?: number; exact?: number };

interface ScannerConstraints {
  video: {
    facingMode?: ScannerStringConstraint;
    width?: ScannerNumberConstraint;
    height?: ScannerNumberConstraint;
  };
}

export interface ScannerControls {
  stop: () => Promise<void> | void;
}

export interface ScannerResult {
  getText: () => string;
}

export interface ScannerReader {
  decodeFromConstraints: (
    constraints: ScannerConstraints,
    videoElementId: string,
    callback: (result: ScannerResult | null, error: unknown) => void
  ) => Promise<ScannerControls>;
  reset?: () => void;
}

interface NativeBarcodeDetection {
  rawValue?: string | null;
}

interface NativeBarcodeDetector {
  detect: (source: HTMLVideoElement) => Promise<NativeBarcodeDetection[]>;
}

interface NativeBarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

let scannerDependenciesPromise: Promise<{
  BrowserStoreBarcodeReader: new (hints?: Map<unknown, unknown>) => ScannerReader;
  BarcodeFormat: Record<string, unknown>;
  DecodeHintType: Record<string, unknown>;
}> | null = null;

async function loadScannerDependencies() {
  if (!scannerDependenciesPromise) {
    scannerDependenciesPromise = import('./zxingStoreScanner').then(scanner => ({
      BrowserStoreBarcodeReader:
        scanner.BrowserStoreBarcodeReader as unknown as new (
          hints?: Map<unknown, unknown>
        ) => ScannerReader,
      BarcodeFormat: scanner.BarcodeFormat as Record<string, unknown>,
      DecodeHintType: scanner.DecodeHintType as Record<string, unknown>,
    }));
  }

  return scannerDependenciesPromise;
}

export function getDeviceId(): string {
  const storageKey = 'scan_device_id';
  let id = localStorage.getItem(storageKey);

  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(storageKey, id);
  }

  return id;
}

export function buildCameraErrorMessage(error: unknown): string {
  const err = error as { name?: string; message?: string } | null;
  const errName = err?.name || '';

  if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
    return 'Camera permission denied. Tap the address bar lock icon and allow camera access.';
  }

  if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
    return 'No camera found on this device.';
  }

  if (errName === 'NotReadableError' || errName === 'TrackStartError') {
    return 'Camera is in use by another app. Close it and try again.';
  }

  if (err?.message) {
    return `Camera error: ${err.message}`;
  }

  return 'Could not access camera.';
}

export function clearScannerVideo(scannerElementId: string): void {
  const videoEl = document.getElementById(scannerElementId) as HTMLVideoElement | null;
  if (videoEl) {
    videoEl.srcObject = null;
  }
}

export async function stopScannerResources(
  scannerElementId: string,
  controls: ScannerControls | null,
  reader: ScannerReader | null
): Promise<void> {
  try {
    if (controls) {
      await controls.stop();
    }
  } catch (error) {
    console.warn('Scanner controls stop warning:', error);
  }

  try {
    reader?.reset?.();
  } catch (error) {
    console.warn('Scanner reset warning:', error);
  }

  clearScannerVideo(scannerElementId);
}

interface StartScannerOptions {
  scannerElementId: string;
  isProcessing: () => boolean;
  onDetected: (code: string) => Promise<void>;
  onUndetected?: () => void;
}

function createScannerConstraints(): ScannerConstraints {
  return {
    video: {
      facingMode: { ideal: 'environment' },
      // A softer initial resolution helps phones bring the preview up faster.
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };
}

export async function startNativeScanner(
  options: StartScannerOptions
): Promise<ScannerControls | null> {
  const { scannerElementId, isProcessing, onDetected, onUndetected } = options;
  const BarcodeDetectorCtor = (globalThis as typeof globalThis & {
    BarcodeDetector?: NativeBarcodeDetectorConstructor;
  }).BarcodeDetector;

  if (!BarcodeDetectorCtor) {
    return null;
  }

  let formats = [...NATIVE_BARCODE_FORMATS];
  if (typeof BarcodeDetectorCtor.getSupportedFormats === 'function') {
    const supportedFormats = await BarcodeDetectorCtor.getSupportedFormats().catch(() => []);
    const matchedFormats = NATIVE_BARCODE_FORMATS.filter(format =>
      supportedFormats.includes(format)
    );

    if (matchedFormats.length === 0) {
      return null;
    }

    formats = [...matchedFormats];
  }

  const videoEl = document.getElementById(scannerElementId) as HTMLVideoElement | null;
  if (!videoEl) {
    throw new Error('Scanner video element not found.');
  }

  let stream: MediaStream | null = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia(createScannerConstraints());

    videoEl.srcObject = stream;
    await videoEl.play();

    const detector = new BarcodeDetectorCtor({ formats });
    let stopped = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let isDetecting = false;

    const stop = () => {
      stopped = true;
      if (timerId !== null) {
        globalThis.clearTimeout(timerId);
        timerId = null;
      }
      stream?.getTracks().forEach(track => track.stop());
      if (videoEl.srcObject === stream) {
        videoEl.srcObject = null;
      }
    };

    const scheduleNext = () => {
      if (stopped) {
        return;
      }

      timerId = globalThis.setTimeout(() => {
        void scanLoop();
      }, NATIVE_SCAN_INTERVAL_MS);
    };

    const scanLoop = async () => {
      if (stopped) {
        return;
      }

      if (
        videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        !isProcessing() &&
        !isDetecting
      ) {
        isDetecting = true;

        try {
          const detected = await detector.detect(videoEl);
          const rawValue = detected.find(code => code.rawValue?.trim())?.rawValue?.trim();
          if (rawValue) {
            await onDetected(rawValue);
          } else {
            onUndetected?.();
          }
        } catch {
          // Keep scanning on transient native detection failures.
        } finally {
          isDetecting = false;
        }
      }

      scheduleNext();
    };

    scheduleNext();

    return { stop };
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    if (videoEl.srcObject === stream) {
      videoEl.srcObject = null;
    }
    throw error;
  }
}

export async function startFallbackScanner(options: StartScannerOptions): Promise<{
  controls: ScannerControls;
  reader: ScannerReader;
}> {
  const { scannerElementId, onDetected, onUndetected } = options;
  const dependencies = await loadScannerDependencies();
  const hints = new Map();

  hints.set(dependencies.DecodeHintType.TRY_HARDER, true);
  hints.set(dependencies.DecodeHintType.POSSIBLE_FORMATS, [
    dependencies.BarcodeFormat.UPC_A,
    dependencies.BarcodeFormat.UPC_E,
    dependencies.BarcodeFormat.EAN_13,
    dependencies.BarcodeFormat.EAN_8,
    dependencies.BarcodeFormat.CODE_128,
    dependencies.BarcodeFormat.CODE_39,
  ]);

  const reader = new dependencies.BrowserStoreBarcodeReader(hints);

  try {
    const controls = await reader.decodeFromConstraints(
      createScannerConstraints(),
      scannerElementId,
      async (result, _error) => {
        if (result) {
          await onDetected(result.getText());
        } else {
          onUndetected?.();
        }
      }
    );

    return { controls, reader };
  } catch (error) {
    reader.reset?.();
    clearScannerVideo(scannerElementId);
    throw error;
  }
}
