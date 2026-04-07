import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, X } from 'lucide-react';
import type { EditDraft } from './types';
import { readFileAsDataUrl } from '../../lib/imageUpload';

interface Props {
  editItem: EditDraft | null;
  editSaving: boolean;
  prefersReducedMotion: boolean | null;
  onChange: (updated: EditDraft) => void;
  onSave: () => void;
  onClose: () => void;
}

export function EditItemModal({ editItem, editSaving, prefersReducedMotion, onChange, onSave, onClose }: Readonly<Props>) {
  return (
    <AnimatePresence>
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }}
            animate={prefersReducedMotion ? {} : { opacity: 1, scale: 1 }}
            exit={prefersReducedMotion ? {} : { opacity: 0, scale: 0.95 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
          >
            <div className="p-5 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-lg font-bold text-navy-900">Edit Item</h3>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto max-h-[90vh]">
              <div>
                <label htmlFor="scan-edit-name" className="block text-sm font-medium text-slate-700 mb-1">Product Name</label>
                <input
                  id="scan-edit-name"
                  type="text"
                  value={editItem.product_name}
                  onChange={e => onChange({ ...editItem, product_name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                  placeholder="Enter product name"
                />
              </div>
              <div>
                <label htmlFor="scan-edit-brand" className="block text-sm font-medium text-slate-700 mb-1">Brand</label>
                <input
                  id="scan-edit-brand"
                  type="text"
                  value={editItem.brand}
                  onChange={e => onChange({ ...editItem, brand: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                  placeholder="Brand (optional)"
                />
              </div>
              <div>
                <label htmlFor="scan-edit-qty" className="block text-sm font-medium text-slate-700 mb-1">Quantity</label>
                <input
                  id="scan-edit-qty"
                  type="number"
                  min="1"
                  value={editItem.quantity}
                  onChange={e => onChange({ ...editItem, quantity: parseInt(e.target.value) || 1 })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="scan-edit-price" className="block text-sm font-medium text-slate-700 mb-1">Sale Price</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                  <input
                    id="scan-edit-price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={editItem.sale_price}
                    onChange={e => onChange({ ...editItem, sale_price: e.target.value })}
                    className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="scan-edit-unit" className="block text-sm font-medium text-slate-700 mb-1">Unit</label>
                <input
                  id="scan-edit-unit"
                  type="text"
                  list="unit-options"
                  value={editItem.unit}
                  onChange={e => onChange({ ...editItem, unit: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent bg-white"
                  placeholder="e.g. each, kg, 500ml, 6-pack"
                />
                <datalist id="unit-options">
                  <option value="each" />
                  <option value="kg" />
                  <option value="lb" />
                  <option value="g" />
                  <option value="oz" />
                  <option value="L" />
                  <option value="ml" />
                  <option value="pack" />
                  <option value="box" />
                  <option value="case" />
                  <option value="dozen" />
                  <option value="pair" />
                  <option value="roll" />
                  <option value="bag" />
                </datalist>
              </div>
              <div>
                <label htmlFor="scan-edit-upc" className="block text-sm font-medium text-slate-700 mb-1">UPC / Barcode</label>
                <input
                  id="scan-edit-upc"
                  type="text"
                  value={editItem.upc}
                  onChange={e => onChange({ ...editItem, upc: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                  placeholder="UPC or barcode"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Product Image</label>
                {editItem.image ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={editItem.image}
                      alt="Product"
                      className="w-[60px] h-[60px] object-contain rounded-lg border border-slate-200"
                    />
                    <button
                      onClick={() => onChange({ ...editItem, image: '' })}
                      className="flex items-center justify-center w-6 h-6 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                      title="Remove image"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const result = await readFileAsDataUrl(file);
                        onChange({ ...editItem, image: result });
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="w-full px-3 py-8 border-2 border-dashed border-slate-300 rounded-lg text-center text-slate-500 hover:border-slate-400 transition-colors cursor-pointer">
                      Click to upload image
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="scan-edit-tags" className="block text-sm font-medium text-slate-700 mb-1">Tags</label>
                <textarea
                  id="scan-edit-tags"
                  rows={2}
                  value={editItem.tag_names}
                  onChange={e => onChange({ ...editItem, tag_names: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent resize-none"
                  placeholder="e.g. organic, gluten-free, sale"
                />
              </div>
            </div>
            <div className="p-5 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={onSave}
                disabled={editSaving || !editItem.product_name.trim()}
                className="px-4 py-2 bg-navy-900 text-white font-medium rounded-lg hover:bg-navy-800 transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {editSaving && <Loader2 size={14} className="animate-spin" />}
                Save
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
