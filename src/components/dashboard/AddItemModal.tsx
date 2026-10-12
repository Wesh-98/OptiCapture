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

export function AddItemModal({
  isOpen,
  formData,
  categories,
  prefersReducedMotion,
  onChange,
  onImageChange,
  onSubmit,
  onClose,
}: Readonly<Props>) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }}
            animate={prefersReducedMotion ? {} : { opacity: 1, scale: 1 }}
            exit={prefersReducedMotion ? {} : { opacity: 0, scale: 0.95 }}
            // Never taller than the screen: the title and buttons stay put, the fields scroll.
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[calc(100dvh-2rem)] flex flex-col"
          >
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center shrink-0">
              <h3 className="text-xl font-bold text-navy-900">Add New Item</h3>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={onSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 min-h-0 overflow-y-auto p-6">
                <ItemFormFields
                  data={formData}
                  onChange={onChange}
                  onImageChange={onImageChange}
                  categories={categories}
                />
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-2 border border-accent-500 text-accent-500 font-medium hover:bg-accent-50 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 transition-colors shadow-lg shadow-brand-600/20"
                >
                  Add Item
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
