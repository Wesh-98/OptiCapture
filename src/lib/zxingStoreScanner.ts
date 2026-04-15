import { BrowserCodeReader } from '@zxing/browser/esm/readers/BrowserCodeReader.js';
import BarcodeFormat from '@zxing/library/esm/core/BarcodeFormat.js';
import DecodeHintType from '@zxing/library/esm/core/DecodeHintType.js';
import NotFoundException from '@zxing/library/esm/core/NotFoundException.js';
import Code128Reader from '@zxing/library/esm/core/oned/Code128Reader.js';
import Code39Reader from '@zxing/library/esm/core/oned/Code39Reader.js';
import MultiFormatUPCEANReader from '@zxing/library/esm/core/oned/MultiFormatUPCEANReader.js';
import OneDReader from '@zxing/library/esm/core/oned/OneDReader.js';

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

export class BrowserStoreBarcodeReader extends BrowserCodeReader {
  constructor(hints?: Map<any, any>) {
    super(new StoreBarcodeReader(hints), hints);
  }
}

export { BarcodeFormat, DecodeHintType };
