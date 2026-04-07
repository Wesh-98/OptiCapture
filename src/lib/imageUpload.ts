export const SUPPORTED_UPLOAD_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export const SUPPORTED_UPLOAD_IMAGE_ACCEPT =
  'image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp';

export const SUPPORTED_UPLOAD_IMAGE_ERROR = 'Unsupported image format. Use JPG, PNG, GIF, or WEBP.';

export function isSupportedUploadImageType(file: File): boolean {
  return SUPPORTED_UPLOAD_IMAGE_MIME_TYPES.includes(
    file.type as (typeof SUPPORTED_UPLOAD_IMAGE_MIME_TYPES)[number]
  );
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') { resolve(reader.result); return; }
      reject(new Error('Could not read file.'));
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}
