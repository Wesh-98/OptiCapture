import BinaryBitmap from '@zxing/library/esm/core/BinaryBitmap.js';
import BarcodeFormat from '@zxing/library/esm/core/BarcodeFormat.js';
import DecodeHintType from '@zxing/library/esm/core/DecodeHintType.js';
import HybridBinarizer from '@zxing/library/esm/core/common/HybridBinarizer.js';
import NotFoundException from '@zxing/library/esm/core/NotFoundException.js';
import RGBLuminanceSource from '@zxing/library/esm/core/RGBLuminanceSource.js';
import Code128Reader from '@zxing/library/esm/core/oned/Code128Reader.js';
import Code39Reader from '@zxing/library/esm/core/oned/Code39Reader.js';
import MultiFormatUPCEANReader from '@zxing/library/esm/core/oned/MultiFormatUPCEANReader.js';
import OneDReader from '@zxing/library/esm/core/oned/OneDReader.js';

const FALLBACK_SCAN_INTERVAL_MS = 150;

class StoreBarcodeReader extends OneDReader {
  private readers: Array<{ decodeRow: (...args: any[]) => any; reset: () => void }> = [];

  constructor(hints?: Map<any, any>) {
    super();

    const possibleFormats = hints?.get(DecodeHintType.POSSIBLE_FORMATS) as unknown[] | undefined;
    const useCode39CheckDigit = hints?.get(DecodeHintType.ASSUME_CODE_39_CHECK_DIGIT) !== undefined;
    const useCode39ExtendedMode =
      hints?.get(DecodeHintType.ENABLE_CODE_39_EXTENDED_MODE) !== undefined;

    if (possibleFormats?.length) {
      if (
        possibleFormats.includes(BarcodeFormat.EAN_13) ||
        possibleFormats.includes(BarcodeFormat.UPC_A) ||
        possibleFormats.includes(BarcodeFormat.EAN_8) ||
        possibleFormats.includes(BarcodeFormat.UPC_E)
      ) {
        this.readers.push(new MultiFormatUPCEANReader(hints));
      }

      if (possibleFormats.includes(BarcodeFormat.CODE_39)) {
        this.readers.push(new Code39Reader(useCode39CheckDigit, useCode39ExtendedMode));
      }

      if (possibleFormats.includes(BarcodeFormat.CODE_128)) {
        this.readers.push(new Code128Reader());
      }
    }

    if (this.readers.length === 0) {
      this.readers.push(new MultiFormatUPCEANReader(hints));
      this.readers.push(new Code39Reader(useCode39CheckDigit, useCode39ExtendedMode));
      this.readers.push(new Code128Reader());
    }
  }

  decodeRow(rowNumber: number, row: any, hints?: Map<any, any>) {
    for (const reader of this.readers) {
      try {
        return reader.decodeRow(rowNumber, row, hints);
      } catch {
        // Try the next configured reader.
      }
    }

    throw new NotFoundException();
  }

  override reset() {
    for (const reader of this.readers) {
      reader.reset();
    }
  }
}

function frameToLuminance(imageData: ImageData): Uint8ClampedArray {
  const { data } = imageData;
  const luminance = new Uint8ClampedArray(imageData.width * imageData.height);

  for (let source = 0, target = 0; source < data.length; source += 4, target += 1) {
    if (data[source + 3] === 0) {
      luminance[target] = 255;
    } else {
      luminance[target] =
        (306 * data[source] + 601 * data[source + 1] + 117 * data[source + 2] + 512) >> 10;
    }
  }

  return luminance;
}

export class BrowserStoreBarcodeReader {
  private readonly reader: StoreBarcodeReader;
  private activeStop: (() => void) | null = null;

  constructor(hints?: Map<any, any>) {
    this.reader = new StoreBarcodeReader(hints);
  }

  async decodeFromConstraints(
    constraints: Parameters<typeof navigator.mediaDevices.getUserMedia>[0],
    videoElementId: string,
    callback: (result: { getText: () => string } | null, error: unknown) => void | Promise<void>
  ) {
    this.reset();

    const video = document.getElementById(videoElementId) as HTMLVideoElement | null;
    if (!video) {
      throw new Error('Scanner video element not found.');
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (timer !== null) {
        globalThis.clearTimeout(timer);
        timer = null;
      }
      stream.getTracks().forEach(track => track.stop());
      if (video.srcObject === stream) video.srcObject = null;
      if (this.activeStop === stop) this.activeStop = null;
    };

    this.activeStop = stop;

    try {
      video.srcObject = stream;
      video.playsInline = true;
      await video.play();

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        throw new Error('Could not create scanner canvas context.');
      }

      const scanFrame = async () => {
        if (stopped) return;

        try {
          if (
            video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            video.videoWidth > 0 &&
            video.videoHeight > 0
          ) {
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
            }

            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const source = new RGBLuminanceSource(
              frameToLuminance(imageData),
              imageData.width,
              imageData.height
            );
            const bitmap = new BinaryBitmap(new HybridBinarizer(source));

            try {
              await callback(this.reader.decode(bitmap), null);
            } catch (error) {
              await callback(null, error);
            } finally {
              this.reader.reset();
            }
          }
        } finally {
          if (!stopped) {
            timer = globalThis.setTimeout(() => void scanFrame(), FALLBACK_SCAN_INTERVAL_MS);
          }
        }
      };

      void scanFrame();
      return { stop };
    } catch (error) {
      stop();
      throw error;
    }
  }

  reset() {
    this.activeStop?.();
    this.activeStop = null;
    this.reader.reset();
  }
}

export { BarcodeFormat, DecodeHintType };
