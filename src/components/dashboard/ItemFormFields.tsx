import React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { Category, ItemForm } from './types';

interface Props {
  data: ItemForm;
  onChange: React.Dispatch<React.SetStateAction<ItemForm>>;
  onImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  categories: Category[];
  imageRequired?: boolean;
}

export function ItemFormFields({ data, onChange, onImageChange, categories, imageRequired = true }: Readonly<Props>) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="col-span-full">
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Item Image {imageRequired && '*'}
        </label>
        <div className="flex items-center gap-4">
          <div className="w-24 h-24 rounded-xl bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center overflow-hidden">
            {data.image ? (
              <img src={data.image} alt="Preview" className="w-full h-full object-cover" />
            ) : (
              <ImageIcon className="text-slate-400" size={32} />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="cursor-pointer bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium">
              {data.image ? 'Change Image' : 'Upload Image'}
              <input
                type="file"
                accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                className="hidden"
                onChange={onImageChange}
                required={imageRequired && !data.image}
              />
            </label>
            {data.image && (
              <button
                type="button"
                onClick={() => onChange(prev => ({ ...prev, image: '' }))}
                className="text-xs text-red-500 hover:text-red-700 text-left"
              >
                Remove image
              </button>
            )}
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="dash-item-name" className="block text-sm font-medium text-slate-700 mb-1">Item Name *</label>
        <input
          id="dash-item-name"
          type="text"
          value={data.item_name}
          onChange={e => onChange(prev => ({ ...prev, item_name: e.target.value }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
          required
        />
      </div>

      <div>
        <label htmlFor="dash-item-upc" className="block text-sm font-medium text-slate-700 mb-1">UPC / Barcode</label>
        <input
          id="dash-item-upc"
          type="text"
          value={data.upc}
          onChange={e => onChange(prev => ({ ...prev, upc: e.target.value }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
          placeholder="e.g. 012345678901"
        />
      </div>

      <div>
        <label htmlFor="dash-item-category" className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
        <select
          id="dash-item-category"
          value={data.category_id}
          onChange={e => onChange(prev => ({ ...prev, category_id: e.target.value }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
          required
        >
          <option value="">Select Category</option>
          {categories.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="dash-item-qty" className="block text-sm font-medium text-slate-700 mb-1">Quantity *</label>
        <input
          id="dash-item-qty"
          type="number"
          value={data.quantity}
          onChange={e => onChange(prev => ({ ...prev, quantity: parseInt(e.target.value) || 0 }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
          required
          min="0"
        />
      </div>

      <div>
        <label htmlFor="dash-item-unit" className="block text-sm font-medium text-slate-700 mb-1">Unit</label>
        <input
          id="dash-item-unit"
          type="text"
          value={data.unit}
          onChange={e => onChange(prev => ({ ...prev, unit: e.target.value }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
          placeholder="e.g. pcs, kg, box"
        />
      </div>

      <div>
        <label htmlFor="dash-item-status" className="block text-sm font-medium text-slate-700 mb-1">Status *</label>
        <select
          id="dash-item-status"
          value={data.status}
          onChange={e => onChange(prev => ({ ...prev, status: e.target.value }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
          required
        >
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
      </div>

      <div>
        <label htmlFor="dash-item-price" className="block text-sm font-medium text-slate-700 mb-1">Sale Price ($)</label>
        <input
          id="dash-item-price"
          type="number"
          step="0.01"
          value={data.sale_price}
          onFocus={e => e.target.select()}
          onChange={e => onChange(prev => ({ ...prev, sale_price: parseFloat(e.target.value) || 0 }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
        />
      </div>

      <div>
        <label htmlFor="dash-item-tax" className="block text-sm font-medium text-slate-700 mb-1">Tax (%)</label>
        <input
          id="dash-item-tax"
          type="number"
          step="0.1"
          value={data.tax_percent}
          onFocus={e => e.target.select()}
          onChange={e => onChange(prev => ({ ...prev, tax_percent: parseFloat(e.target.value) || 0 }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
        />
      </div>

      <div className="col-span-full">
        <label htmlFor="dash-item-desc" className="block text-sm font-medium text-slate-700 mb-1">Description</label>
        <textarea
          id="dash-item-desc"
          value={data.description}
          onChange={e => onChange(prev => ({ ...prev, description: e.target.value }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
          rows={3}
        />
      </div>

      <div className="col-span-full">
        <label htmlFor="dash-item-tags" className="block text-sm font-medium text-slate-700 mb-1">Tags</label>
        <input
          id="dash-item-tags"
          type="text"
          value={data.tag_names}
          onChange={e => onChange(prev => ({ ...prev, tag_names: e.target.value }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
          placeholder="Comma separated tags..."
        />
      </div>
    </div>
  );
}
