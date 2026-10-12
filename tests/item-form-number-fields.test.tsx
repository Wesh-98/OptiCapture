// @vitest-environment jsdom
/**
 * tests/item-form-number-fields.test.tsx — item number boxes can be cleared
 *
 * Quantity, price and tax used to turn an empty box straight back into 0, so the starting
 * 0 could only be replaced by selecting it or using the arrows.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ItemFormFields } from '../src/components/dashboard/ItemFormFields';
import { emptyForm, type ItemForm } from '../src/components/dashboard/types';
import { EditItemModal } from '../src/components/scan/EditItemModal';
import type { EditDraft } from '../src/components/scan/types';

function Harness() {
  const [data, setData] = useState<ItemForm>({ ...emptyForm });
  return <ItemFormFields data={data} onChange={setData} onImageChange={() => {}} categories={[]} />;
}

afterEach(cleanup);

describe('ItemFormFields number boxes', () => {
  it.each(['Quantity *', 'Sale Price ($)', 'Tax (%)'])('%s can be cleared and retyped', label => {
    render(<Harness />);
    const input = screen.getByLabelText(label) as HTMLInputElement;
    expect(input.value).toBe('0');

    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: '5' } });
    expect(input.value).toBe('5');
  });
});

describe('ItemFormFields required fields', () => {
  it('asks for a UPC on a new item but not an image', () => {
    const { container } = render(<Harness />);
    expect((screen.getByLabelText('UPC / Barcode *') as HTMLInputElement).required).toBe(true);
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(picker.required).toBe(false);
    expect(screen.getByText('Item Image').textContent).toBe('Item Image');
  });
});

describe('scan session EditItemModal quantity', () => {
  function ScanHarness() {
    const [draft, setDraft] = useState<EditDraft | null>({
      id: 1,
      product_name: 'Cola',
      brand: '',
      quantity: 1,
      upc: '012',
      image: '',
      tag_names: '',
      sale_price: '',
      unit: '',
    });
    return (
      <EditItemModal
        editItem={draft}
        editSaving={false}
        prefersReducedMotion
        onChange={setDraft}
        onSave={() => {}}
        onClose={() => {}}
      />
    );
  }

  it('can be cleared, and Save waits for a quantity', () => {
    render(<ScanHarness />);
    const input = screen.getByLabelText('Quantity') as HTMLInputElement;
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    expect(save.disabled).toBe(true);

    fireEvent.change(input, { target: { value: '3' } });
    expect(input.value).toBe('3');
    expect(save.disabled).toBe(false);
  });
});
