export interface SessionItem {
  id: number;
  upc: string;
  quantity: number;
  product_name: string | null;
  brand: string | null;
  image: string | null;
  scanned_at: string;
  lookup_status: string;
  source: string | null;
  exists_in_inventory: number;
  sale_price: number | null;
  unit: string | null;
}

export interface ServerInfo {
  ip: string;
  port: number;
  protocol: string;
  mobileUrl?: string;
  tunnelUrl?: string | null;
}

export interface EditDraft {
  id: number;
  product_name: string;
  brand: string;
  quantity: number;
  upc: string;
  image: string;
  tag_names: string;
  sale_price: string;
  unit: string;
}

export interface Category {
  id: number;
  name: string;
  icon: string;
  status: string;
}

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning';
  message: string;
}

export type UiStatus = 'idle' | 'loading' | 'ready' | 'error' | 'committing';
