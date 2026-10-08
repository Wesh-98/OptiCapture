import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Category } from '../dashboard/types';
import type { AdminItem } from '../../hooks/useAdminItemDetail';
import { FILTER_INPUT } from './AdminUi';
import { formatPrice } from './format';

const MAX_REASON = 500;

type Field =
  | 'item_name'
  | 'upc'
  | 'category_id'
  | 'sale_price'
  | 'tax_percent'
  | 'unit'
  | 'status'
  | 'description';

interface FormValues {
  item_name: string;
  upc: string;
  category_id: string;
  sale_price: string;
  tax_percent: string;
  unit: string;
  status: string;
  description: string;
}

interface Change {
  field: Field;
  label: string;
  from: string;
  to: string;
  value: unknown;
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
  onSaved: (item: Partial<AdminItem>) => void;
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
          expected_updated_at: item.updated_at,
          reason: reason.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setConflict(res.status === 409 && /changed since/i.test(data?.error ?? ''));
        setError(data?.error || 'Could not save the changes.');
        return;
      }
      onSaved(data.item);
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
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className="text-theme-muted line-through">{change.from}</span>
                <ArrowRight size={14} className="text-brand-600 shrink-0" aria-label="to" />
                <span className="font-semibold text-black">{change.to}</span>
              </p>
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
