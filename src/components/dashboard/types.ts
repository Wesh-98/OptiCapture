import {
  CupSoda, Cookie, Cigarette, Home, Car, ShoppingCart, Shirt, Pill, Wrench,
  Coffee, Apple, Fish, Baby, Dumbbell, Tv, Smartphone, Book, Leaf, PawPrint,
  Wine, Beer, Beef, Pizza, Candy, Gamepad2, Headphones, Camera, Droplets,
  SprayCan, Briefcase, Gift, Truck, ChefHat, Flame, Grape, Carrot, Milk,
  Sandwich, Scissors, Music, Sparkles, Star, Banana, Egg, FlaskConical,
  Flower2, IceCream2, Popcorn, Paintbrush, LeafyGreen, Zap, BottleWine,
  Croissant, Newspaper,
} from 'lucide-react';
import type React from 'react';

export interface Category {
  id: number;
  name: string;
  status: string;
  icon: string;
  item_count: number;
  total_stock: number;
}

export interface InventoryItem {
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

export interface DashboardStats {
  totalCategories: number;
  totalItems: number;
  inStock: number;
  outOfStock: number;
}

export interface ActiveSession {
  session_id: string;
  status: 'active' | 'draft' | 'completed';
  item_count: number;
  last_scan_at: string | null;
  created_at: string;
  created_by: string;
  otp: string;
  label: string | null;
}

export const iconMap: Record<string, React.ElementType> = {
  CupSoda, Cookie, Cigarette, Home, Car, ShoppingCart, Shirt, Pill, Wrench,
  Coffee, Apple, Fish, Baby, Dumbbell, Tv, Smartphone, Book, Leaf, PawPrint,
  Wine, Beer, Beef, Pizza, Candy, Gamepad2, Headphones, Camera, Droplets,
  SprayCan, Briefcase, Gift, Truck, ChefHat, Flame, Grape, Carrot, Milk,
  Sandwich, Scissors, Music, Sparkles, Star, Banana, Egg, FlaskConical,
  Flower2, IceCream2, Popcorn, Paintbrush, LeafyGreen, Zap, BottleWine,
  Croissant, Newspaper,
};

export const colorMap: Record<string, { bg: string; icon: string }> = {
  CupSoda:      { bg: 'bg-sky-100',      icon: 'text-sky-600' },
  Wine:         { bg: 'bg-purple-100',   icon: 'text-purple-600' },
  Beer:         { bg: 'bg-amber-100',    icon: 'text-amber-600' },
  Coffee:       { bg: 'bg-amber-100',    icon: 'text-amber-800' },
  Milk:         { bg: 'bg-blue-50',      icon: 'text-blue-400' },
  Droplets:     { bg: 'bg-sky-100',      icon: 'text-sky-500' },
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
  Home:         { bg: 'bg-violet-100',   icon: 'text-violet-600' },
  SprayCan:     { bg: 'bg-cyan-100',     icon: 'text-cyan-500' },
  Flower2:      { bg: 'bg-pink-100',     icon: 'text-pink-400' },
  Cigarette:    { bg: 'bg-gray-100',     icon: 'text-gray-500' },
  Pill:         { bg: 'bg-rose-100',     icon: 'text-rose-600' },
  Flame:        { bg: 'bg-red-100',      icon: 'text-red-600' },
  FlaskConical: { bg: 'bg-teal-100',     icon: 'text-teal-600' },
  Shirt:        { bg: 'bg-indigo-100',   icon: 'text-indigo-600' },
  Scissors:     { bg: 'bg-fuchsia-100',  icon: 'text-fuchsia-600' },
  Paintbrush:   { bg: 'bg-teal-100',     icon: 'text-teal-500' },
  Car:          { bg: 'bg-slate-200',    icon: 'text-slate-600' },
  Wrench:       { bg: 'bg-orange-100',   icon: 'text-orange-600' },
  Truck:        { bg: 'bg-blue-100',     icon: 'text-blue-600' },
  Zap:          { bg: 'bg-yellow-100',   icon: 'text-yellow-500' },
  Tv:           { bg: 'bg-blue-100',     icon: 'text-blue-600' },
  Smartphone:   { bg: 'bg-sky-100',      icon: 'text-sky-600' },
  Headphones:   { bg: 'bg-indigo-100',   icon: 'text-indigo-500' },
  Camera:       { bg: 'bg-teal-100',     icon: 'text-teal-600' },
  Gamepad2:     { bg: 'bg-violet-100',   icon: 'text-violet-600' },
  Music:        { bg: 'bg-violet-100',   icon: 'text-violet-500' },
  PawPrint:     { bg: 'bg-orange-100',   icon: 'text-orange-500' },
  ShoppingCart: { bg: 'bg-emerald-100',  icon: 'text-emerald-600' },
  Gift:         { bg: 'bg-rose-100',     icon: 'text-rose-500' },
  Sparkles:     { bg: 'bg-amber-100',    icon: 'text-amber-500' },
  Star:         { bg: 'bg-yellow-100',   icon: 'text-yellow-600' },
  Briefcase:    { bg: 'bg-gray-100',     icon: 'text-gray-600' },
  Book:         { bg: 'bg-yellow-100',   icon: 'text-yellow-700' },
  Baby:         { bg: 'bg-pink-100',     icon: 'text-pink-500' },
  Dumbbell:     { bg: 'bg-purple-100',   icon: 'text-purple-600' },
  BottleWine:   { bg: 'bg-purple-100',   icon: 'text-purple-600' },
  Croissant:    { bg: 'bg-amber-100',    icon: 'text-amber-700' },
  Newspaper:    { bg: 'bg-slate-100',    icon: 'text-slate-600' },
};

export const IMAGE_ICONS = [
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

export const LUCIDE_ICON_PICKS = [
  'Cookie', 'CupSoda', 'Coffee', 'Milk', 'Beer', 'Candy', 'Pizza',
  'Apple', 'Carrot', 'Sandwich', 'IceCream2', 'ChefHat', 'Cigarette',
  'Pill', 'Shirt', 'Car', 'Wrench', 'Smartphone', 'Tv', 'Gamepad2',
  'PawPrint', 'ShoppingCart', 'Gift', 'Book', 'Dumbbell', 'Sparkles',
];

export const emptyForm = {
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
  tag_names: '',
};

export type ItemForm = typeof emptyForm;
