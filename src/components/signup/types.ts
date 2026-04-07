export interface SignupFormData {
  storeName: string;
  street: string;
  zipcode: string;
  state: string;
  phone: string;
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
}

export type SignupField = keyof SignupFormData;

export const EMPTY_SIGNUP_FORM: SignupFormData = {
  storeName: '',
  street: '',
  zipcode: '',
  state: '',
  phone: '',
  email: '',
  username: '',
  password: '',
  confirmPassword: '',
};

export const validateZipcode = (value: string): boolean => !value || /^\d{5}(-\d{4})?$/.test(value);

export const validatePhone = (value: string): boolean =>
  !value || /^\d{10}$/.test(value.replaceAll(/\D/g, ''));

export const validateEmail = (value: string): boolean =>
  !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const validatePassword = (value: string): boolean =>
  value.length >= 8 && /[A-Z]/.test(value) && /\d/.test(value);

export function validateSignupForm(
  formData: SignupFormData,
  isGooglePrefilled: boolean
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!formData.storeName.trim()) {
    errors.storeName = 'Store name is required';
  }

  if (!formData.username.trim()) {
    errors.username = 'Username is required';
  }

  if (formData.email && !validateEmail(formData.email)) {
    errors.email = 'Enter a valid email address';
  }

  if (formData.phone && !validatePhone(formData.phone)) {
    errors.phone = 'Phone must be 10 digits';
  }

  if (formData.zipcode && !validateZipcode(formData.zipcode)) {
    errors.zipcode = 'Format: 12345 or 12345-6789';
  }

  if (!isGooglePrefilled) {
    if (!validatePassword(formData.password)) {
      errors.password = 'Min 8 chars, 1 uppercase letter, 1 number';
    }

    if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }
  }

  return errors;
}
