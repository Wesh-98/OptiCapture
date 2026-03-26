import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Search, Package, Plus, X, MoreHorizontal, ArrowLeft, Box, Layers, Image as ImageIcon, Pencil, ChevronLeft, ChevronRight, CupSoda, Cookie, Cigarette, Home, Car, ShoppingCart, Shirt, Pill, Wrench, Coffee, Apple, Fish, Baby, Dumbbell, Tv, Smartphone, Book, Leaf, PawPrint, Wine, Beer, Beef, Pizza, Candy, Gamepad2, Headphones, Camera, Droplets, SprayCan, Briefcase, Gift, Truck, ChefHat, Flame, Grape, Carrot, Milk, Sandwich, Scissors, Music, Sparkles, Star, Banana, Egg, FlaskConical, Flower2, IceCream2, Popcorn, Paintbrush, LeafyGreen, Zap, BottleWine, Croissant, Newspaper, Eye, EyeOff, Trash2, Download, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../context/AuthContext';

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

const iconMap: Record<string, React.ElementType> = {
  // Existing
  CupSoda, Cookie, Cigarette, Home, Car,
  ShoppingCart, Shirt, Pill, Wrench, Coffee, Apple,
  Fish, Baby, Dumbbell, Tv, Smartphone, Book, Leaf, PawPrint,
  // New
  Wine, Beer, Beef, Pizza, Candy, Gamepad2, Headphones, Camera,
  Droplets, SprayCan, Briefcase, Gift, Truck, ChefHat, Flame,
  Grape, Carrot, Milk, Sandwich, Scissors, Music, Sparkles,
  Star, Banana, Egg, FlaskConical, Flower2, IceCream2, Popcorn,
  Paintbrush, LeafyGreen, Zap,
  BottleWine, Croissant, Newspaper,
};

const colorMap: Record<string, { bg: string; icon: string }> = {
  // Drinks
  CupSoda:      { bg: 'bg-sky-100',      icon: 'text-sky-600' },
  Wine:         { bg: 'bg-purple-100',   icon: 'text-purple-600' },
  Beer:         { bg: 'bg-amber-100',    icon: 'text-amber-600' },
  Coffee:       { bg: 'bg-amber-100',    icon: 'text-amber-800' },
  Milk:         { bg: 'bg-blue-50',      icon: 'text-blue-400' },
  Droplets:     { bg: 'bg-sky-100',      icon: 'text-sky-500' },
  // Food
  Cookie:       { bg: 'bg-orange-100',   icon: 'text-orange-600' },
  Pizza:        { bg: 'bg-orange-100',   icon: 'text-orange-500' },
  Candy:        { bg: 'bg-pink-100',     icon: 'text-pink-600' },
  Beef:         { bg: 'bg-red-100',      icon: 'text-red-500' },
  Fish:         { bg: 'bg-cyan-100',     icon: 'text-cyan-600' },
  Apple:        { bg: 'bg-green-100',    icon: 'text-green-600' },
  Carrot:       { bg: 'bg-orange-100',   icon: 'text-orange-500' },
  Grape:        { bg: 'bg-purple-100',   icon: 'text-purple-500' },
  Banana:       { bg: 'bg-yellow-100',   icon: 'text-yellow-600' },
  Egg:          { bg: 'bg-orange-50',    icon: 'text-orange-400' },
  Sandwich:     { bg: 'bg-yellow-100',   icon: 'text-yellow-700' },
  IceCream2:    { bg: 'bg-pink-100',     icon: 'text-pink-500' },
  Popcorn:      { bg: 'bg-yellow-100',   icon: 'text-yellow-600' },
  ChefHat:      { bg: 'bg-amber-100',    icon: 'text-amber-700' },
  LeafyGreen:   { bg: 'bg-lime-100',     icon: 'text-lime-600' },
  Leaf:         { bg: 'bg-lime-100',     icon: 'text-lime-600' },
  // Home & Cleaning
  Home:         { bg: 'bg-violet-100',   icon: 'text-violet-600' },
  SprayCan:     { bg: 'bg-cyan-100',     icon: 'text-cyan-500' },
  Flower2:      { bg: 'bg-pink-100',     icon: 'text-pink-400' },
  // Tobacco
  Cigarette:    { bg: 'bg-gray-100',     icon: 'text-gray-500' },
  // Health
  Pill:         { bg: 'bg-rose-100',     icon: 'text-rose-600' },
  Flame:        { bg: 'bg-red-100',      icon: 'text-red-600' },
  FlaskConical: { bg: 'bg-teal-100',     icon: 'text-teal-600' },
  // Clothing & Beauty
  Shirt:        { bg: 'bg-indigo-100',   icon: 'text-indigo-600' },
  Scissors:     { bg: 'bg-fuchsia-100',  icon: 'text-fuchsia-600' },
  Paintbrush:   { bg: 'bg-teal-100',     icon: 'text-teal-500' },
  // Automotive & Tools
  Car:          { bg: 'bg-slate-200',    icon: 'text-slate-600' },
  Wrench:       { bg: 'bg-orange-100',   icon: 'text-orange-600' },
  Truck:        { bg: 'bg-blue-100',     icon: 'text-blue-600' },
  Zap:          { bg: 'bg-yellow-100',   icon: 'text-yellow-500' },
  // Electronics & Entertainment
  Tv:           { bg: 'bg-blue-100',     icon: 'text-blue-600' },
  Smartphone:   { bg: 'bg-sky-100',      icon: 'text-sky-600' },
  Headphones:   { bg: 'bg-indigo-100',   icon: 'text-indigo-500' },
  Camera:       { bg: 'bg-teal-100',     icon: 'text-teal-600' },
  Gamepad2:     { bg: 'bg-violet-100',   icon: 'text-violet-600' },
  Music:        { bg: 'bg-violet-100',   icon: 'text-violet-500' },
  // Pets & Nature
  PawPrint:     { bg: 'bg-orange-100',   icon: 'text-orange-500' },
  // Shopping & General
  ShoppingCart: { bg: 'bg-emerald-100',  icon: 'text-emerald-600' },
  Gift:         { bg: 'bg-rose-100',     icon: 'text-rose-500' },
  Sparkles:     { bg: 'bg-amber-100',    icon: 'text-amber-500' },
  Star:         { bg: 'bg-yellow-100',   icon: 'text-yellow-600' },
  // Office
  Briefcase:    { bg: 'bg-gray-100',     icon: 'text-gray-600' },
  Book:         { bg: 'bg-yellow-100',   icon: 'text-yellow-700' },
  // Baby & Fitness
  Baby:         { bg: 'bg-pink-100',     icon: 'text-pink-500' },
  Dumbbell:     { bg: 'bg-purple-100',   icon: 'text-purple-600' },
  // Wine & Beer / Pets / Pastries / Newspaper
  BottleWine:   { bg: 'bg-purple-100',   icon: 'text-purple-600' },
  Croissant:    { bg: 'bg-amber-100',    icon: 'text-amber-700' },
  Newspaper:    { bg: 'bg-slate-100',    icon: 'text-slate-600' },
};

const IMAGE_ICONS = [
  { label: 'Soft Drinks',    src: '/icons/soft-drinks.png' },
  { label: 'Snacks',         src: '/icons/snack.png' },
  { label: 'Candy',          src: '/icons/candy.png' },
  { label: 'Household',      src: '/icons/household-items.png' },
  { label: 'Automotive',     src: '/icons/automotive.png' },
  { label: 'Cold Coffee',    src: '/icons/cold-coffee.png' },
  { label: 'Dairy',          src: '/icons/dairy.png' },
  { label: 'Electronics',    src: '/icons/electronics.png' },
  { label: 'Wine & Beer',    src: '/icons/beer-wine.png' },
  { label: 'Pets',           src: '/icons/pet-food.png' },
  { label: 'Pastries',       src: '/icons/pastry.png' },
  { label: 'Newspaper',      src: '/icons/newspaper.png' },
  { label: 'Energy Drinks',  src: '/icons/energy-drink.png' },
  { label: 'Frozen Food',    src: '/icons/frozen-food.png' },
  { label: 'Grocery',        src: '/icons/grocery.png' },
  { label: 'Gum & Mints',    src: '/icons/gum-mint.png' },
  { label: 'Juices',         src: '/icons/juice-tea-lemonade.png' },
  { label: 'Non-Tobacco',    src: '/icons/non-tobacco.png' },
  { label: 'Nutrition',      src: '/icons/nutrition-snacks.png' },
  { label: 'Personal Care',  src: '/icons/personal-care.png' },
  { label: 'Sports Drinks',  src: '/icons/sports-drink.png' },
  { label: 'Water',          src: '/icons/water.png' },
  { label: 'Scratch Tickets',src: '/icons/scratch-tickets.png' },
  { label: 'Phone Cards',    src: '/icons/phone-cards.png' },
];

const LUCIDE_ICON_PICKS = [
  'Cookie', 'CupSoda', 'Coffee', 'Milk', 'Beer', 'Candy', 'Pizza',
  'Apple', 'Carrot', 'Sandwich', 'IceCream2', 'ChefHat', 'Cigarette',
  'Pill', 'Shirt', 'Car', 'Wrench', 'Smartphone', 'Tv', 'Gamepad2',
  'PawPrint', 'ShoppingCart', 'Gift', 'Book', 'Dumbbell', 'Sparkles',
];

const emptyForm = {
  image: '',
  item_name: '',
  upc: '',
  unit: '',
  quantity: 0,
  category_id: '',
  status: 'Active',
  sale_price: 0,
  tax_percent: 0,
  description: '',
  tag_names: ''
};

export default function Dashboard() {
  const { user } = useAuth();
  const isOwner = user?.role !== 'taker';
  const prefersReducedMotion = useReducedMotion();
  const [viewMode, setViewMode] = useState<'categories' | 'items'>('categories');
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [stats, setStats] = useState<DashboardStats>({ totalCategories: 0, totalItems: 0, inStock: 0, outOfStock: 0 });
  const [search, setSearch] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [activeActionMenu, setActiveActionMenu] = useState<number | null>(null);
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<number | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<number | null>(null);

  // Add form state
  const [formData, setFormData] = useState({ ...emptyForm });

  // Category management state
  const [showCatModal, setShowCatModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [catForm, setCatForm] = useState({ name: '', icon: '' });
  const [catError, setCatError] = useState('');
  const [catSaving, setCatSaving] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<number | null>(null);

  // Edit modal state
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editFormData, setEditFormData] = useState({ ...emptyForm });

  // Export state
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'xlsx'|'csv'|'json'|'pdf'>('xlsx');
  const [exporting, setExporting] = useState(false);

  // Global search state
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchResults, setSearchResults] = useState<InventoryItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const globalSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pagination state
  const [pageSize, setPageSize] = useState<50 | 100 | 200>(50);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    fetchStats();
    fetchCategories();
  }, []);

  useEffect(() => {
    if (viewMode === 'items' && selectedCategory) {
      fetchItems(selectedCategory.id);
      setCurrentPage(1);
    }
  }, [viewMode, selectedCategory]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  useEffect(() => {
    if (globalSearchTimer.current) clearTimeout(globalSearchTimer.current);
    if (!globalSearch.trim()) { setSearchResults([]); setIsSearching(false); return; }
    setIsSearching(true);
    globalSearchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/inventory?q=${encodeURIComponent(globalSearch.trim())}`, { credentials: 'include' });
        if (res.ok) setSearchResults(await res.json());
      } catch { /* ignore */ }
      finally { setIsSearching(false); }
    }, 300);
  }, [globalSearch]);

  const fetchStats = async () => {
    const res = await fetch('/api/dashboard/stats', { credentials: 'include' });
    if (res.ok) setStats(await res.json());
  };

  const fetchCategories = async () => {
    const res = await fetch('/api/categories', { credentials: 'include' });
    if (res.ok) setCategories(await res.json());
  };

  const fetchItems = async (categoryId: number) => {
    const res = await fetch(`/api/inventory?category_id=${categoryId}`, { credentials: 'include' });
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
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        setIsAddModalOpen(false);
        setFormData({ ...emptyForm });
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

  const handleEditItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    try {
      const res = await fetch(`/api/inventory/${editingItem.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editFormData),
      });

      if (res.ok) {
        setEditingItem(null);
        fetchStats();
        if (viewMode === 'items' && selectedCategory) fetchItems(selectedCategory.id);
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to update item');
      }
    } catch (error) {
      console.error(error);
      alert('An error occurred');
    }
  };

  const openEditModal = (item: InventoryItem) => {
    setEditingItem(item);
    setEditFormData({
      image: item.image ?? '',
      item_name: item.item_name ?? '',
      upc: item.upc ?? '',
      unit: item.unit ?? '',
      quantity: item.quantity ?? 0,
      category_id: String(item.category_id ?? ''),
      status: item.status ?? 'Active',
      sale_price: item.sale_price ?? 0,
      tax_percent: item.tax_percent ?? 0,
      description: item.description ?? '',
      tag_names: item.tag_names ?? ''
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, target: 'add' | 'edit') => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        if (target === 'add') setFormData(prev => ({ ...prev, image: result }));
        else setEditFormData(prev => ({ ...prev, image: result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCategoryAction = async (categoryId: number, action: 'activate' | 'deactivate' | 'deleteItems') => {
    setActiveActionMenu(null);
    try {
      if (action === 'activate' || action === 'deactivate') {
        await fetch(`/api/categories/${categoryId}/status`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: action === 'activate' ? 'Active' : 'Inactive' }),
        });
      } else if (action === 'deleteItems') {
        await fetch(`/api/categories/${categoryId}/items`, {
          method: 'DELETE',
          credentials: 'include',
        });
      }
      fetchCategories();
      fetchStats();
    } catch {}
  };

  const handleSaveCategory = async () => {
    if (!catForm.name.trim()) { setCatError('Category name is required'); return; }
    setCatError('');
    setCatSaving(true);
    try {
      const url = editingCategory ? `/api/categories/${editingCategory.id}` : '/api/categories';
      const method = editingCategory ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: catForm.name.trim(), icon: catForm.icon || 'Package' }),
      });
      const data = await res.json();
      if (!res.ok) { setCatError(data.error || 'Failed to save category'); return; }
      setShowCatModal(false);
      setEditingCategory(null);
      setCatForm({ name: '', icon: '' });
      fetchCategories();
    } catch {
      setCatError('Failed to save category');
    } finally {
      setCatSaving(false);
    }
  };

  const handleDeleteItem = async (itemId: number) => {
    setDeletingItemId(itemId);
    try {
      await fetch(`/api/inventory/${itemId}`, { method: 'DELETE', credentials: 'include' });
      setItems(prev => prev.filter(i => i.id !== itemId));
      fetchStats();
    } catch {} finally {
      setDeletingItemId(null);
      setConfirmDeleteItemId(null);
    }
  };

  const handleDeleteCategory = async (catId: number) => {
    try {
      await fetch(`/api/categories/${catId}`, { method: 'DELETE', credentials: 'include' });
      setActiveActionMenu(null);
      setDeletingCategoryId(null);
      fetchCategories();
      fetchStats();
    } catch {}
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/inventory/export?format=${exportFormat}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inventory.${exportFormat}`;
      a.click();
      URL.revokeObjectURL(url);
      setShowExportModal(false);
    } catch {
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
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

        {isOwner && (
          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-700 text-white rounded-xl text-sm font-medium hover:bg-slate-600 transition-colors shadow-md whitespace-nowrap"
          >
            <Download size={16} /> Export
          </button>
        )}
      </div>

      {/* Global Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          type="text"
          value={globalSearch}
          onChange={e => setGlobalSearch(e.target.value)}
          placeholder="Search all inventory by name, UPC, or category..."
          className="w-full pl-9 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-700 shadow-sm"
        />
        {globalSearch && (
          <button onClick={() => setGlobalSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Main Content Area */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden min-h-[500px]">
        {/* Toolbar */}
        <div className="p-3 border-b border-slate-200 flex flex-wrap items-center gap-3 justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            {viewMode === 'items' && (
              <button
                onClick={() => setViewMode('categories')}
                className="p-2 hover:bg-slate-200 rounded-lg text-slate-600 transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
            )}
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              {viewMode === 'categories' ? (
                <><Layers size={20} className="text-slate-400" />Categories</>
              ) : (
                <><Box size={20} className="text-slate-400" />{selectedCategory?.name} Items</>
              )}
            </h2>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {viewMode === 'categories' && isOwner && (
              <>
                <button
                  onClick={() => {
                    setEditingCategory(null);
                    setCatForm({ name: '', icon: '' });
                    setCatError('');
                    setShowCatModal(true);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-navy-900 hover:bg-navy-800 rounded-lg text-xs font-medium text-white transition-colors whitespace-nowrap"
                >
                  <Plus size={13} />
                  <span className="hidden sm:inline">Add Category</span>
                  <span className="sm:hidden">Category</span>
                </button>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-navy-900 hover:bg-navy-800 rounded-lg text-xs font-medium text-white transition-colors whitespace-nowrap"
                >
                  <Plus size={13} />
                  <span className="hidden sm:inline">Add New Item</span>
                  <span className="sm:hidden">Item</span>
                </button>
              </>
            )}
            <div className="relative w-36 sm:w-48 md:w-56">
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
        </div>

        {/* Global Search Results */}
        {globalSearch.trim() && (
          <div className="overflow-x-auto">
            {isSearching ? (
              <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-sm">Searching...</span>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Search size={32} className="mb-3 opacity-40" />
                <p className="text-sm font-medium">No items match &ldquo;{globalSearch}&rdquo;</p>
              </div>
            ) : (
              <>
                <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 text-xs text-slate-500 font-medium">
                  {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for &ldquo;{globalSearch}&rdquo;
                </div>
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Item</th>
                      <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Category</th>
                      <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Stock</th>
                      <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Price</th>
                      <th className="px-6 py-4 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {searchResults.map(item => (
                      <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0 border border-slate-200">
                              {item.image
                                ? <img src={item.image} alt={item.item_name} className="w-full h-full object-cover" />
                                : <div className="w-full h-full flex items-center justify-center text-slate-400"><ImageIcon size={16} /></div>}
                            </div>
                            <div>
                              <p className="font-medium text-navy-900">{item.item_name}</p>
                              <p className="text-xs text-slate-500 font-mono">{item.upc || 'No UPC'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-600">{item.category_name || '—'}</td>
                        <td className="px-6 py-4 text-sm font-mono font-medium text-navy-900">{item.quantity}</td>
                        <td className="px-6 py-4">
                          <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                            item.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600')}>
                            {item.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-right font-mono text-slate-700">
                          ${item.sale_price?.toFixed(2) || '0.00'}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1">
                            {isOwner && (
                              <button onClick={() => openEditModal(item)}
                                className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-navy-900 transition-colors">
                                <Pencil size={15} />
                              </button>
                            )}
                            {isOwner && (confirmDeleteItemId === item.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleDeleteItem(item.id)}
                                  disabled={deletingItemId === item.id}
                                  className="px-2 py-1 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                                >
                                  {deletingItemId === item.id ? '…' : 'Delete'}
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteItemId(null)}
                                  className="px-2 py-1 text-xs font-medium bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => setConfirmDeleteItemId(item.id)}
                                className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600 transition-colors">
                                <Trash2 size={15} />
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        {/* Categories View */}
        {!globalSearch.trim() && viewMode === 'categories' && (
          <div className="overflow-x-auto">
            {activeActionMenu !== null && (
              <div className="fixed inset-0 z-10" onClick={() => setActiveActionMenu(null)} />
            )}
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
                {categories.filter(c => c.name.toLowerCase().includes(search.toLowerCase())).map((cat) => {
                  const isImageIcon = cat.icon?.startsWith('/') || cat.icon?.startsWith('http');
                  const CategoryIcon = !isImageIcon ? (iconMap[cat.icon] ?? Package) : Package;
                  const isInactive = cat.status !== 'Active';
                  return (
                  <tr key={cat.id} className={cn(
                    'transition-colors group',
                    isInactive ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-slate-50'
                  )}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {(() => {
                          const color = isInactive
                            ? { bg: 'bg-red-50', icon: 'text-red-400' }
                            : (colorMap[cat.icon] ?? { bg: 'bg-slate-100', icon: 'text-slate-500' });
                          return (
                            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden', color.bg, !isImageIcon && color.icon)}>
                              {isImageIcon
                                ? <img src={cat.icon} alt={cat.name} className={cn('w-6 h-6 object-contain', isInactive && 'opacity-40')} />
                                : <CategoryIcon size={20} />
                              }
                            </div>
                          );
                        })()}
                        <span className="font-semibold text-slate-900">{cat.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                        cat.status === 'Active' ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"
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
                        <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-lg shadow-xl border border-slate-100 z-20 py-1 text-left">
                          {/* View Items — always visible */}
                          <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                            onClick={() => { setSelectedCategory(cat); setViewMode('items'); setActiveActionMenu(null); fetchItems(cat.id); }}>
                            <Eye size={14} /> View Items
                          </button>

                          {/* Owner-only actions */}
                          {isOwner && (
                            <>
                              <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                onClick={() => {
                                  setEditingCategory(cat);
                                  setCatForm({ name: cat.name, icon: cat.icon || '' });
                                  setCatError('');
                                  setShowCatModal(true);
                                  setActiveActionMenu(null);
                                }}>
                                <Pencil size={14} /> Edit Category
                              </button>

                              <div className="border-t border-slate-100 my-1" />

                              <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                onClick={() => handleCategoryAction(cat.id, cat.status === 'Active' ? 'deactivate' : 'activate')}>
                                {cat.status === 'Active' ? <><EyeOff size={14} /> Set All Inactive</> : <><Eye size={14} /> Set All Active</>}
                              </button>

                              <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                onClick={() => handleCategoryAction(cat.id, 'deleteItems')}>
                                <Trash2 size={14} /> Delete All Items
                              </button>

                              <div className="border-t border-slate-100 my-1" />

                              {deletingCategoryId === cat.id ? (
                                <button className="w-full text-left px-4 py-2 text-sm text-red-600 font-semibold hover:bg-red-50 flex items-center gap-2"
                                  onClick={() => handleDeleteCategory(cat.id)}>
                                  <Trash2 size={14} /> Confirm Delete?
                                </button>
                              ) : (
                                <button className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 flex items-center gap-2"
                                  onClick={() => setDeletingCategoryId(cat.id)}>
                                  <Trash2 size={14} /> Delete Category
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Items View */}
        {!globalSearch.trim() && viewMode === 'items' && (() => {
          const filteredItems = items.filter(i => i.item_name.toLowerCase().includes(search.toLowerCase()));
          const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
          const pagedItems = filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);
          return (
            <>
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
                      <th className="px-6 py-4 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pagedItems.map((item) => (
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
                        <td className="px-6 py-4">
                          {isOwner && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openEditModal(item)}
                                className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-navy-900 transition-colors"
                              >
                                <Pencil size={15} />
                              </button>
                              {confirmDeleteItemId === item.id ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleDeleteItem(item.id)}
                                    disabled={deletingItemId === item.id}
                                    className="px-2 py-1 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                                  >
                                    {deletingItemId === item.id ? '…' : 'Delete'}
                                  </button>
                                  <button
                                    onClick={() => setConfirmDeleteItemId(null)}
                                    className="px-2 py-1 text-xs font-medium bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300 transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirmDeleteItemId(item.id)}
                                  className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600 transition-colors"
                                >
                                  <Trash2 size={15} />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination footer */}
              <div className="px-6 py-3 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between gap-4 flex-wrap">
                <p className="text-xs text-slate-500">
                  {filteredItems.length === 0 ? 'No items' : (
                    <>Showing <span className="font-semibold text-slate-700">{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredItems.length)}</span> of <span className="font-semibold text-slate-700">{filteredItems.length}</span> items</>
                  )}
                </p>

                <div className="flex items-center gap-3">
                  {/* Page size toggle */}
                  <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
                    {([50, 100, 200] as const).map(size => (
                      <button
                        key={size}
                        onClick={() => { setPageSize(size); setCurrentPage(1); }}
                        className={cn(
                          'px-3 py-1 text-xs font-semibold rounded-md transition-colors',
                          pageSize === size
                            ? 'bg-navy-900 text-white'
                            : 'text-slate-500 hover:text-navy-900 hover:bg-slate-100'
                        )}
                      >
                        {size}
                      </button>
                    ))}
                  </div>

                  {/* Arrow navigation */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="p-1.5 rounded-lg bg-navy-900 text-white hover:bg-navy-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="px-3 py-1 text-xs font-semibold text-navy-900 min-w-[5rem] text-center">
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="p-1.5 rounded-lg bg-navy-900 text-white hover:bg-navy-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* Add Item Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }}
              animate={prefersReducedMotion ? {} : { opacity: 1, scale: 1 }}
              exit={prefersReducedMotion ? {} : { opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="p-6 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white z-10">
                <h3 className="text-xl font-bold text-navy-900">Add New Item</h3>
                <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleAddItem} className="p-6 space-y-6">
                <ItemFormFields
                  data={formData}
                  onChange={setFormData}
                  onImageChange={(e) => handleImageUpload(e, 'add')}
                  categories={categories}
                />
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

      {/* Edit Item Modal */}
      <AnimatePresence>
        {editingItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }}
              animate={prefersReducedMotion ? {} : { opacity: 1, scale: 1 }}
              exit={prefersReducedMotion ? {} : { opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="p-6 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white z-10">
                <h3 className="text-xl font-bold text-navy-900">Edit Item</h3>
                <button onClick={() => setEditingItem(null)} className="text-slate-400 hover:text-slate-600">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleEditItem} className="p-6 space-y-6">
                <ItemFormFields
                  data={editFormData}
                  onChange={setEditFormData}
                  onImageChange={(e) => handleImageUpload(e, 'edit')}
                  categories={categories}
                  imageRequired={false}
                />
                <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setEditingItem(null)}
                    className="px-6 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-navy-900 text-white font-medium rounded-lg hover:bg-navy-800 transition-colors shadow-lg shadow-navy-900/20"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add/Edit Category Modal */}
      {showCatModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">
                {editingCategory ? 'Edit Category' : 'Add Category'}
              </h3>
              <button onClick={() => setShowCatModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Category Name</label>
                <input
                  type="text"
                  value={catForm.name}
                  onChange={e => setCatForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                  placeholder="e.g. Beverages"
                  autoFocus
                />
              </div>

              {/* Icon picker */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Icon</label>

                {/* Image icons */}
                <p className="text-xs text-slate-400 mb-2 font-medium uppercase tracking-wide">Image Icons</p>
                <div className="grid grid-cols-6 gap-1.5 max-h-36 overflow-y-auto p-1">
                  {IMAGE_ICONS.map(icon => (
                    <button
                      key={icon.src}
                      type="button"
                      title={icon.label}
                      onClick={() => setCatForm(p => ({ ...p, icon: icon.src }))}
                      className={cn(
                        'w-full aspect-square rounded-lg p-1.5 border-2 transition-all flex items-center justify-center',
                        catForm.icon === icon.src
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                      )}
                    >
                      <img src={icon.src} alt={icon.label} className="w-7 h-7 object-contain" />
                    </button>
                  ))}
                </div>

                {/* Lucide icons */}
                <p className="text-xs text-slate-400 mt-3 mb-2 font-medium uppercase tracking-wide">Generic Icons</p>
                <div className="grid grid-cols-6 gap-1.5 max-h-28 overflow-y-auto p-1">
                  {LUCIDE_ICON_PICKS.map(iconName => {
                    const IconComp = iconMap[iconName];
                    if (!IconComp) return null;
                    const col = colorMap[iconName] ?? { bg: 'bg-slate-100', icon: 'text-slate-500' };
                    return (
                      <button
                        key={iconName}
                        type="button"
                        title={iconName}
                        onClick={() => setCatForm(p => ({ ...p, icon: iconName }))}
                        className={cn(
                          'w-full aspect-square rounded-lg flex items-center justify-center border-2 transition-all',
                          col.bg,
                          catForm.icon === iconName
                            ? 'border-blue-500 ring-2 ring-blue-200'
                            : 'border-transparent hover:border-slate-300'
                        )}
                      >
                        <IconComp size={18} className={col.icon} />
                      </button>
                    );
                  })}
                </div>
              </div>

              {catError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{catError}</p>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-6 pb-6">
              <button
                onClick={() => { setShowCatModal(false); setEditingCategory(null); }}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCategory}
                disabled={catSaving}
                className="px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60 transition-colors bg-navy-900"
              >
                {catSaving ? 'Saving...' : editingCategory ? 'Save Changes' : 'Add Category'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowExportModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-navy-900 mb-1">Export Inventory</h3>
            <p className="text-sm text-slate-500 mb-4">Choose a format to download your inventory.</p>
            <div className="grid grid-cols-2 gap-2 mb-5">
              {([
                { id: 'xlsx', label: 'Excel', desc: '.xlsx — re-importable' },
                { id: 'csv',  label: 'CSV',   desc: '.csv — universal' },
                { id: 'json', label: 'JSON',  desc: '.json — full backup' },
                { id: 'pdf',  label: 'PDF',   desc: '.pdf — print report' },
              ] as const).map(f => (
                <button
                  key={f.id}
                  onClick={() => setExportFormat(f.id)}
                  className={`p-3 rounded-xl border text-left transition-colors ${exportFormat === f.id ? 'bg-navy-900 border-navy-900' : 'border-slate-200 hover:bg-slate-50'}`}
                >
                  <p className={`text-sm font-semibold ${exportFormat === f.id ? 'text-white' : 'text-slate-800'}`}>{f.label}</p>
                  <p className={`text-xs mt-0.5 ${exportFormat === f.id ? 'text-slate-300' : 'text-slate-400'}`}>{f.desc}</p>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowExportModal(false)} className="flex-1 px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="flex-1 px-4 py-2 rounded-lg bg-navy-900 text-white text-sm font-medium hover:bg-navy-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {exporting
                  ? <><Loader2 size={14} className="animate-spin" /> Exporting...</>
                  : <><Download size={14} /> Download</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Shared form fields for Add and Edit modals
function ItemFormFields({
  data,
  onChange,
  onImageChange,
  categories,
  imageRequired = true,
}: {
  data: typeof emptyForm;
  onChange: React.Dispatch<React.SetStateAction<typeof emptyForm>>;
  onImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  categories: Category[];
  imageRequired?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Image Upload */}
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
        <label className="block text-sm font-medium text-slate-700 mb-1">Item Name *</label>
        <input
          type="text"
          value={data.item_name}
          onChange={e => onChange(prev => ({ ...prev, item_name: e.target.value }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">UPC / Barcode</label>
        <input
          type="text"
          value={data.upc}
          onChange={e => onChange(prev => ({ ...prev, upc: e.target.value }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
          placeholder="e.g. 012345678901"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
        <select
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
        <label className="block text-sm font-medium text-slate-700 mb-1">Quantity *</label>
        <input
          type="number"
          value={data.quantity}
          onChange={e => onChange(prev => ({ ...prev, quantity: parseInt(e.target.value) || 0 }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
          required
          min="0"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Unit</label>
        <input
          type="text"
          value={data.unit}
          onChange={e => onChange(prev => ({ ...prev, unit: e.target.value }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
          placeholder="e.g. pcs, kg, box"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Status *</label>
        <select
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
        <label className="block text-sm font-medium text-slate-700 mb-1">Sale Price ($)</label>
        <input
          type="number"
          step="0.01"
          value={data.sale_price}
          onFocus={e => e.target.select()}
          onChange={e => onChange(prev => ({ ...prev, sale_price: parseFloat(e.target.value) || 0 }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Tax (%)</label>
        <input
          type="number"
          step="0.1"
          value={data.tax_percent}
          onFocus={e => e.target.select()}
          onChange={e => onChange(prev => ({ ...prev, tax_percent: parseFloat(e.target.value) || 0 }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
        />
      </div>

      <div className="col-span-full">
        <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
        <textarea
          value={data.description}
          onChange={e => onChange(prev => ({ ...prev, description: e.target.value }))}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-navy-700 focus:border-transparent"
          rows={3}
        />
      </div>

      <div className="col-span-full">
        <label className="block text-sm font-medium text-slate-700 mb-1">Tags</label>
        <input
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
