import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { ItemFormFields } from './ItemFormFields';
import type { Category, ItemForm } from './types';

interface Props {
  isOpen: boolean;
  formData: ItemForm;
  categories: Category[];
  prefersReducedMotion: boolean | null;
  onChange: React.Dispatch<React.SetStateAction<ItemForm>>;
  onImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export function AddItemModal({ isOpen, formData, categories, prefersReducedMotion, onChange, onImageChange, onSubmit, onClose }: Readonly<Props>) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }}
            animate={prefersReducedMotion ? {} : { opacity: 1, scale: 1 }}
            exit={prefersReducedMotion ? {} : { opacity: 0, scale: 0.95 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="p-6 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white z-10">
              <h3 className="text-xl font-bold text-navy-900">Add New Item</h3>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
            </div>
            <form onSubmit={onSubmit} className="p-6 space-y-6">
              <ItemFormFields data={formData} onChange={onChange} onImageChange={onImageChange} categories={categories} />
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={onClose} className="px-6 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                <button type="submit" className="px-6 py-2 bg-navy-900 text-white font-medium rounded-lg hover:bg-navy-800 transition-colors shadow-lg shadow-navy-900/20">Add Item</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
