export interface StoreRow {
  id: number;
  name: string;
  address: string;
  email: string;
  phone: string;
  status: string;
  created_at: string;
  user_count: number;
  item_count: number;
  logo?: string | null;
  street?: string;
  zipcode?: string;
  state?: string;
}

export interface StoreUser {
  id: number;
  username: string;
  email?: string;
  role: string;
}

export const validateZipcode = (v: string) => !v || /^\d{5}(-\d{4})?$/.test(v);
export const validatePhone   = (v: string) => !v || /^\d{10}$/.test(v.replaceAll(/\D/g, ''));
export const validateEmail   = (v: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
