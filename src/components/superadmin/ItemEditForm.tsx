import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Image as ImageIcon, RotateCcw, Trash2, Upload } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  isSupportedUploadImageType,
  readFileAsDataUrl,
  SUPPORTED_UPLOAD_IMAGE_ACCEPT,
  SUPPORTED_UPLOAD_IMAGE_ERROR,
} from '../../lib/imageUpload';
import type { Category } from '../dashboard/types';
import type { AdminItem, SameUpcEntry } from '../../hooks/useAdminItemDetail';
import { FILTER_INPUT } from './AdminUi';
import { formatPrice } from './format';

const MAX_REASON = 500;
// The server's cap on a decoded upload.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type Field =
  | 'item_name'
  | 'upc'
  | 'category_id'
  | 'sale_price'
  | 'tax_percent'
  | 'unit'
  | 'status'
  | 'description'
  | 'image';

interface FormValues {
  item_name: string;
  upc: string;
  category_id: string;
  sale_price: string;
  tax_percent: string;
  unit: string;
  status: string;
  description: string;
  /** The current image path, a new upload as a data URL, or '' for none. */
  image: string;
}

interface Change {
  field: Field;
  label: string;
  from: string;
  to: string;
  value: unknown;
  /** Image changes show thumbnails in the review instead of text. */
  images?: { from: string; to: string };
}

const text = (value: unknown) => (value == null ? '' : String(value));
const shown = (value: string) => value.trim() || '—';
const numberOrNull = (value: string) => (value.trim() === '' ? null : Number(value));

function initialValues(item: AdminItem): FormValues {
  return {
    item_name: text(item.item_name),
    upc: text(item.upc),
    category_id: text(item.category_id),
    sale_price: text(item.sale_price),
    tax_percent: text(item.tax_percent),
    unit: text(item.unit),
    status: item.status === 'Inactive' ? 'Inactive' : 'Active',
    description: text(item.description),
    image: text(item.image),
  };
}

// Only the fields that really differ from the item go to the server, each with the
// before → after the review step shows.
function diffValues(item: AdminItem, values: FormValues, categories: Category[]): Change[] {
  const start = initialValues(item);
  const categoryName = (id: string) =>
    id === '' ? 'Uncategorized' : (categories.find(c => String(c.id) === id)?.name ?? 'Category');
  const changes: Change[] = [];
  const add = (field: Field, label: string, from: string, to: string, value: unknown) => {
    if (from !== to) changes.push({ field, label, from, to, value });
  };

  add(
    'item_name',
    'Name',
    start.item_name.trim(),
    values.item_name.trim(),
    values.item_name.trim()
  );
  add('upc', 'UPC', shown(start.upc), shown(values.upc), values.upc.trim() || null);
  add(
    'category_id',
    'Category',
    categoryName(start.category_id),
    categoryName(values.category_id),
    values.category_id === '' ? null : Number(values.category_id)
  );
  const price = (v: string) => (v.trim() === '' ? '—' : formatPrice(Number(v)));
  add(
    'sale_price',
    'Price',
    price(start.sale_price),
    price(values.sale_price),
    numberOrNull(values.sale_price)
  );
  const tax = (v: string) => (v.trim() === '' ? '—' : `${Number(v)}%`);
  add(
    'tax_percent',
    'Tax',
    tax(start.tax_percent),
    tax(values.tax_percent),
    numberOrNull(values.tax_percent)
  );
  add('unit', 'Unit', shown(start.unit), shown(values.unit), values.unit.trim() || null);
  add('status', 'Status', start.status, values.status, values.status);
  if (start.description !== values.description) {
    changes.push({
      field: 'description',
      label: 'Description',
      from: 'Previous text',
      to: 'New text',
      value: values.description || null,
    });
  }
  if (start.image !== values.image) {
    changes.push({
      field: 'image',
      label: 'Image',
      from: start.image ? 'Current image' : 'No image',
      to: values.image ? 'New image' : 'No image',
      value: values.image || null,
      images: { from: start.image, to: values.image },
    });
  }
  return changes;
}

function validate(values: FormValues): string {
  if (!values.item_name.trim()) return 'Name is required.';
  for (const [label, raw, max] of [
    ['Price', values.sale_price, 1_000_000],
    ['Tax', values.tax_percent, 100],
  ] as const) {
    if (raw.trim() === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > max) return `${label} must be between 0 and ${max}.`;
  }
  return '';
}

/**
 * Superadmin edit of one item: edit, then review every change before it is saved. The
 * server refuses the save if the store changed the item in the meantime.
 */
export function ItemEditForm({
  storeId,
  item,
  categories,
  onSaved,
  onCancel,
  onReload,
}: Readonly<{
  storeId: string;
  item: AdminItem;
  categories: Category[];
  onSaved: (item: Partial<AdminItem>, otherStores: SameUpcEntry[]) => void;
  onCancel: () => void;
  onReload: () => void;
}>) {
  const [values, setValues] = useState<FormValues>(() => initialValues(item));
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);

  const changes = useMemo(() => diffValues(item, values, categories), [item, values, categories]);
  const set = (field: keyof FormValues) => (value: string) =>
    setValues(prev => ({ ...prev, [field]: value }));

  // Checked here first so a wrong file is caught before the review step; the server checks
  // the type, size and actual bytes again.
  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    if (!isSupportedUploadImageType(file)) {
      setError(SUPPORTED_UPLOAD_IMAGE_ERROR);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Image too large. Maximum size is 5 MB.');
      return;
    }
    try {
      set('image')(await readFileAsDataUrl(file));
      setError('');
    } catch {
      setError('Could not read that file.');
    }
  };

  const review = () => {
    const problem = validate(values);
    setError(problem);
    if (!problem) setStep('review');
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/stores/${storeId}/items/${item.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changes: Object.fromEntries(changes.map(c => [c.field, c.value])),
          expected_revision: item.revision,
          reason: reason.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setConflict(res.status === 409 && /changed since/i.test(data?.error ?? ''));
        setError(data?.error || 'Could not save the changes.');
        return;
      }
      onSaved(data.item, data.other_stores ?? []);
    } catch {
      setError('Could not reach the server. Nothing was saved.');
    } finally {
      setSaving(false);
    }
  };

  const errorBox = error && (
    <div className="rounded-lg border border-accent-100 bg-accent-50 px-3 py-2 text-sm text-accent-700">
      <p>{error}</p>
      {conflict && (
        <button
          type="button"
          onClick={onReload}
          className="mt-1.5 font-semibold text-accent-700 underline"
        >
          Reload item
        </button>
      )}
    </div>
  );

  if (step === 'review') {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-black">Review changes</h2>
          <p className="text-sm text-theme-muted">
            These are saved to the store and recorded in its activity log.
          </p>
        </div>
        <ul className="rounded-xl border border-theme-border divide-y divide-theme-border/60">
          {changes.map(change => (
            <li key={change.field} className="px-3.5 py-2.5 text-sm">
              <p className="text-xs text-theme-muted">{change.label}</p>
              {change.images ? (
                <p className="mt-1 flex items-center gap-2">
                  <Thumb src={change.images.from} faded />
                  <ArrowRight size={14} className="text-brand-600 shrink-0" aria-label="to" />
                  <Thumb src={change.images.to} />
                </p>
              ) : (
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-theme-muted line-through">{change.from}</span>
                  <ArrowRight size={14} className="text-brand-600 shrink-0" aria-label="to" />
                  <span className="font-semibold text-black">{change.to}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
        <label className="block">
          <span className="text-xs text-theme-muted">Reason (optional)</span>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value.slice(0, MAX_REASON))}
            rows={3}
            placeholder="Why is this changing? Saved with the change."
            className={cn('mt-1 w-full px-3 py-2', FILTER_INPUT)}
          />
        </label>
        {errorBox}
        <div className="flex gap-2">
          <SecondaryButton onClick={() => setStep('edit')} disabled={saving}>
            Back
          </SecondaryButton>
          <PrimaryButton onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Confirm and save'}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-3.5"
      onSubmit={e => {
        e.preventDefault();
        review();
      }}
    >
      <h2 className="text-lg font-bold text-black">Edit item</h2>
      <div>
        <span className="text-xs text-theme-muted">Image</span>
        <div className="mt-1 w-full h-40 rounded-xl overflow-hidden border border-theme-border bg-theme-canvas flex items-center justify-center text-slate-400">
          {values.image ? (
            <img src={values.image} alt="" className="w-full h-full object-cover" />
          ) : (
            <ImageIcon size={28} aria-label="No image" />
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-brand-400 bg-white px-3 text-sm font-semibold text-brand-600 hover:bg-brand-50 focus-within:ring-2 focus-within:ring-brand-400">
            <Upload size={15} />
            {values.image ? 'Replace image' : 'Add image'}
            <input
              type="file"
              accept={SUPPORTED_UPLOAD_IMAGE_ACCEPT}
              className="sr-only"
              onChange={e => {
                void pickImage(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {values.image && (
            <button
              type="button"
              onClick={() => set('image')('')}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-accent-100 bg-white px-3 text-sm font-semibold text-accent-600 hover:bg-accent-50"
            >
              <Trash2 size={15} />
              Remove
            </button>
          )}
          {values.image !== text(item.image) && (
            <button
              type="button"
              onClick={() => set('image')(text(item.image))}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-theme-muted hover:text-theme-text"
            >
              <RotateCcw size={14} />
              Undo
            </button>
          )}
        </div>
      </div>
      <FormField label="Name">
        <input
          value={values.item_name}
          onChange={e => set('item_name')(e.target.value)}
          maxLength={500}
          className={cn('w-full h-10 px-3', FILTER_INPUT)}
        />
      </FormField>
      <FormField label="UPC">
        <input
          value={values.upc}
          onChange={e => set('upc')(e.target.value)}
          className={cn('w-full h-10 px-3 font-mono', FILTER_INPUT)}
        />
      </FormField>
      <FormField label="Category">
        <select
          value={values.category_id}
          onChange={e => set('category_id')(e.target.value)}
          className={cn('w-full h-10 px-2.5', FILTER_INPUT)}
        >
          <option value="">Uncategorized</option>
          {categories.map(category => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Price ($)">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={values.sale_price}
            onChange={e => set('sale_price')(e.target.value)}
            className={cn('w-full h-10 px-3', FILTER_INPUT)}
          />
        </FormField>
        <FormField label="Tax (%)">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="0.01"
            value={values.tax_percent}
            onChange={e => set('tax_percent')(e.target.value)}
            className={cn('w-full h-10 px-3', FILTER_INPUT)}
          />
        </FormField>
        <FormField label="Unit">
          <input
            value={values.unit}
            onChange={e => set('unit')(e.target.value)}
            className={cn('w-full h-10 px-3', FILTER_INPUT)}
          />
        </FormField>
        <FormField label="Status">
          <select
            value={values.status}
            onChange={e => set('status')(e.target.value)}
            className={cn('w-full h-10 px-2.5', FILTER_INPUT)}
          >
            <option value="Active">Active</option>
            <option value="Inactive">In-Active</option>
          </select>
        </FormField>
      </div>
      <FormField label="Description">
        <textarea
          value={values.description}
          onChange={e => set('description')(e.target.value)}
          maxLength={2000}
          rows={4}
          className={cn('w-full px-3 py-2', FILTER_INPUT)}
        />
      </FormField>
      {errorBox}
      <div className="flex gap-2">
        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
        <PrimaryButton type="submit" disabled={changes.length === 0}>
          {changes.length === 0
            ? 'No changes'
            : `Review ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}`}
        </PrimaryButton>
      </div>
    </form>
  );
}

function Thumb({ src, faded = false }: Readonly<{ src: string; faded?: boolean }>) {
  return (
    <span
      className={cn(
        'w-16 h-16 shrink-0 rounded-lg overflow-hidden border border-theme-border bg-theme-canvas flex items-center justify-center text-slate-400',
        faded && 'opacity-60'
      )}
    >
      {src ? (
        <img src={src} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="text-xs">None</span>
      )}
    </span>
  );
}

function FormField({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <label className="block">
      <span className="text-xs text-theme-muted">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
}: Readonly<{
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}>) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="flex-1 h-10 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
}: Readonly<{ children: ReactNode; onClick: () => void; disabled?: boolean }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-10 rounded-lg border border-brand-400 bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-50 transition-colors"
    >
      {children}
    </button>
  );
}
