import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, AlertTriangle, CheckCircle, Package, Plus, X, MoreHorizontal, ArrowLeft, Box, Layers, Archive, Image as ImageIcon } from 'lucide-react';
import { cn } from '../lib/utils';

interface Category {
  id: number;
  name: string;
  status: string;
  icon: string;
  item_count: number;
  total_stock: number;
}

interface InventoryItem {
  id: number;
  item_name: string;
  description: string;
  quantity: number;
  unit: string;
  category_id: number;
  category_name: string;
  status: string;
  sale_price: number;
  tax_percent: number;
  image: string;
  upc: string;
  number: string;
  tag_names: string;
  updated_at: string;
}

interface DashboardStats {
  totalCategories: number;
  totalItems: number;
  inStock: number;
  outOfStock: number;
}

export default function Dashboard() {
  const [viewMode, setViewMode] = useState<'categories' | 'items'>('categories');
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [stats, setStats] = useState<DashboardStats>({ totalCategories: 0, totalItems: 0, inStock: 0, outOfStock: 0 });
  const [search, setSearch] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [activeActionMenu, setActiveActionMenu] = useState<number | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    image: '',
    item_name: '',
    unit: '',
    quantity: 0,
    category_id: '',
    status: 'Active',
    sale_price: 0,
    tax_percent: 0,
    description: '',
    tag_names: ''
  });

  useEffect(() => {
    fetchStats();
    fetchCategories();
  }, []);

  useEffect(() => {
    if (viewMode === 'items' && selectedCategory) {
      fetchItems(selectedCategory.id);
    }
  }, [viewMode, selectedCategory]);

  const fetchStats = async () => {
    const res = await fetch('/api/dashboard/stats');
    if (res.ok) setStats(await res.json());
  };

  const fetchCategories = async () => {
    const res = await fetch('/api/categories');
    if (res.ok) setCategories(await res.json());
  };

  const fetchItems = async (categoryId: number) => {
    const res = await fetch(`/api/inventory?category_id=${categoryId}`);
    if (res.ok) setItems(await res.json());
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.image || !formData.item_name || !formData.category_id) {
      alert('Please fill in all required fields (*)');
      return;
    }

    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        alert('Item added successfully');
        setIsAddModalOpen(false);
        setFormData({
          image: '',
          item_name: '',
          unit: '',
          quantity: 0,
          category_id: '',
          status: 'Active',
          sale_price: 0,
          tax_percent: 0,
          description: '',
          tag_names: ''
        });
        fetchStats();
        fetchCategories();
        if (viewMode === 'items' && selectedCategory) fetchItems(selectedCategory.id);
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to add item');
      }
    } catch (error) {
      console.error(error);
      alert('An error occurred');
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData({ ...formData, image: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCategoryAction = async (action: 'view' | 'inactive' | 'delete', category: Category) => {
    setActiveActionMenu(null);
    if (action === 'view') {
      setSelectedCategory(category);
      setViewMode('items');
    } else if (action === 'inactive') {
      if (confirm(`Set all items in ${category.name} to Inactive?`)) {
        await fetch(`/api/categories/${category.id}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'Inactive' }),
        });
        fetchCategories();
      }
    } else if (action === 'delete') {
      if (confirm(`Delete ALL items in ${category.name}? This cannot be undone.`)) {
        await fetch(`/api/categories/${category.id}/items`, { method: 'DELETE' });
        fetchCategories();
        fetchStats();
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full md:w-auto flex-1">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <p className="text-xs text-slate-500 uppercase font-bold">Total Categories</p>
            <p className="text-2xl font-bold text-navy-900 mt-1">{stats.totalCategories}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <p className="text-xs text-slate-500 uppercase font-bold">Total Items</p>
            <p className="text-2xl font-bold text-navy-900 mt-1">{stats.totalItems}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <p className="text-xs text-slate-500 uppercase font-bold text-emerald-600">In Stock</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{stats.inStock}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <p className="text-xs text-slate-500 uppercase font-bold text-red-600">Out of Stock</p>
            <p className="text-2xl font-bold text-red-700 mt-1">{stats.outOfStock}</p>
          </div>
        </div>
        
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="bg-navy-900 text-white px-6 py-3 rounded-xl font-medium hover:bg-navy-800 transition-colors shadow-lg shadow-navy-900/20 flex items-center gap-2 whitespace-nowrap"
        >
          <Plus size={20} />
          Add New Item
        </button>
      </div>

      {/* Main Content Area */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden min-h-[500px]">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-4">
            {viewMode === 'items' && (
              <button 
                onClick={() => setViewMode('categories')}
                className="p-2 hover:bg-slate-200 rounded-lg text-slate-600 transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
            )}
            <h2 className="text-lg font-bold text-navy-900 flex items-center gap-2">
              {viewMode === 'categories' ? (
                <>
                  <Layers size={20} className="text-slate-400" />
                  All Categories
                </>
              ) : (
                <>
                  <Box size={20} className="text-slate-400" />
                  {selectedCategory?.name} Items
                </>
              )}
            </h2>
          </div>
          
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={viewMode === 'categories' ? "Search categories..." : "Search items..."}
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-navy-700"
            />
          </div>
        </div>

        {/* Categories View */}
        {viewMode === 'categories' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Category</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Stock Count</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.filter(c => c.name.toLowerCase().includes(search.toLowerCase())).map((cat) => (
                  <tr key={cat.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500">
                          {/* Placeholder for dynamic icons based on cat.icon */}
                          <Package size={20} />
                        </div>
                        <span className="font-medium text-navy-900">{cat.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                        cat.status === 'Active' ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                      )}>
                        {cat.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 font-mono">
                      {cat.total_stock || 0} units
                    </td>
                    <td className="px-6 py-4 text-right relative">
                      <button 
                        onClick={() => setActiveActionMenu(activeActionMenu === cat.id ? null : cat.id)}
                        className="p-2 hover:bg-slate-200 rounded-full text-slate-400 hover:text-navy-900 transition-colors"
                      >
                        <MoreHorizontal size={20} />
                      </button>
                      
                      {activeActionMenu === cat.id && (
                        <div className="absolute right-8 top-8 w-48 bg-white rounded-lg shadow-xl border border-slate-100 z-10 py-1 text-left">
                          <button 
                            onClick={() => handleCategoryAction('view', cat)}
                            className="w-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                          >
                            <Box size={16} /> View Items
                          </button>
                          <button 
                            onClick={() => handleCategoryAction('inactive', cat)}
                            className="w-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                          >
                            <Archive size={16} /> Set All Inactive
                          </button>
                          <button 
                            onClick={() => handleCategoryAction('delete', cat)}
                            className="w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                          >
                            <X size={16} /> Delete All Items
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Items View */}
        {viewMode === 'items' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 w-10">
                    <input type="checkbox" className="rounded border-slate-300 text-navy-900 focus:ring-navy-700" />
                  </th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Item</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Unit</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Stock</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Category</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.filter(i => i.item_name.toLowerCase().includes(search.toLowerCase())).map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <input type="checkbox" className="rounded border-slate-300 text-navy-900 focus:ring-navy-700" />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0 border border-slate-200">
                          {item.image ? (
                            <img src={item.image} alt={item.item_name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-400">
                              <ImageIcon size={16} />
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-navy-900">{item.item_name}</p>
                          <p className="text-xs text-slate-500">{item.upc || 'No UPC'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">{item.unit || '-'}</td>
                    <td className="px-6 py-4 text-sm font-mono font-medium text-navy-900">{item.quantity}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">{item.category_name}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                        item.status === 'Active' ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                      )}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-right font-mono text-slate-700">
                      ${item.sale_price?.toFixed(2) || '0.00'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Item Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="p-6 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white z-10">
                <h3 className="text-xl font-bold text-navy-900">Add New Item</h3>
                <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={24} />
                </button>
              </div>
              
              <form onSubmit={handleAddItem} className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Image Upload */}
                  <div className="col-span-full">
                    <label className="block text-sm font-medium text-slate-700 mb-2">Item Image *</label>
                    <div className="flex items-center gap-4">
                      <div className="w-24 h-24 rounded-xl bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center overflow-hidden">
                        {formData.image ? (
                          <img src={formData.image} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon className="text-slate-400" size={32} />
                        )}
                      </div>
                      <label className="cursor-pointer bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium">
                        Upload Image
                        <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} required />
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Item Name *</label>
                    <input 
                      type="text" 
                      value={formData.item_name}
                      onChange={e => setFormData({...formData, item_name: e.target.value})}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
                    <select 
                      value={formData.category_id}
                      onChange={e => setFormData({...formData, category_id: e.target.value})}
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
                    <label className="block text-sm font-medium text-slate-700 mb-1">Quantity *</label>
                    <input 
                      type="number" 
                      value={formData.quantity}
                      onChange={e => setFormData({...formData, quantity: parseInt(e.target.value) || 0})}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                      required
                      min="0"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Unit</label>
                    <input 
                      type="text" 
                      value={formData.unit}
                      onChange={e => setFormData({...formData, unit: e.target.value})}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                      placeholder="e.g. pcs, kg, box"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Status *</label>
                    <select 
                      value={formData.status}
                      onChange={e => setFormData({...formData, status: e.target.value})}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                      required
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Sale Price ($)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={formData.sale_price}
                      onChange={e => setFormData({...formData, sale_price: parseFloat(e.target.value) || 0})}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Tax (%)</label>
                    <input 
                      type="number" 
                      step="0.1"
                      value={formData.tax_percent}
                      onChange={e => setFormData({...formData, tax_percent: parseFloat(e.target.value) || 0})}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                    />
                  </div>

                  <div className="col-span-full">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                    <textarea 
                      value={formData.description}
                      onChange={e => setFormData({...formData, description: e.target.value})}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                      rows={3}
                    />
                  </div>

                  <div className="col-span-full">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Tags</label>
                    <input 
                      type="text" 
                      value={formData.tag_names}
                      onChange={e => setFormData({...formData, tag_names: e.target.value})}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                      placeholder="Comma separated tags..."
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                  <button 
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-6 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="px-6 py-2 bg-navy-900 text-white font-medium rounded-lg hover:bg-navy-800 transition-colors shadow-lg shadow-navy-900/20"
                  >
                    Add Item
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
