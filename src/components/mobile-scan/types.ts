export type MobileScanInputMode = 'camera' | 'manual';

export interface ScannedItem {
  id: number;
  name: string;
  upc: string;
  unit: string;
  ts: Date;
  quantity: number;
}

export interface ScanToast {
  type: 'success' | 'error';
  message: string;
}
