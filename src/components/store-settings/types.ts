export interface StoreInfo {
  name: string;
  street: string;
  zipcode: string;
  state: string;
  phone: string;
  email: string;
  logo: string;
}

export interface PasswordForm {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

export type StoreInfoField = keyof StoreInfo;
export type PasswordField = keyof PasswordForm;

export const EMPTY_STORE_INFO: StoreInfo = {
  name: '',
  street: '',
  zipcode: '',
  state: '',
  phone: '',
  email: '',
  logo: '',
};

export const EMPTY_PASSWORD_FORM: PasswordForm = {
  current_password: '',
  new_password: '',
  confirm_password: '',
};

export const validateZipcode = (value: string): boolean => !value || /^\d{5}(-\d{4})?$/.test(value);

export const validatePhone = (value: string): boolean =>
  !value || /^\d{10}$/.test(value.replaceAll(/\D/g, ''));

export const validateEmail = (value: string): boolean =>
  !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const validatePassword = (value: string): boolean =>
  value.length >= 8 && /[A-Z]/.test(value) && /\d/.test(value);

export function validateStoreInfo(storeInfo: StoreInfo): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!storeInfo.name.trim()) {
    errors.name = 'Store name is required';
  }

  if (storeInfo.email && !validateEmail(storeInfo.email)) {
    errors.email = 'Enter a valid email address';
  }

  if (storeInfo.phone && !validatePhone(storeInfo.phone)) {
    errors.phone = 'Phone must be 10 digits';
  }

  if (storeInfo.zipcode && !validateZipcode(storeInfo.zipcode)) {
    errors.zipcode = 'Format: 12345 or 12345-6789';
  }

  return errors;
}

export function validatePasswordForm(passwordForm: PasswordForm): string | null {
  if (!validatePassword(passwordForm.new_password)) {
    return 'Min 8 chars, 1 uppercase letter, 1 number';
  }

  if (passwordForm.new_password !== passwordForm.confirm_password) {
    return 'New password and confirmation do not match.';
  }

  return null;
}
