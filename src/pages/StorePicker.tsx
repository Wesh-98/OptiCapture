import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Building2, LogOut, Store } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function StorePicker() {
  const { user, myStores, switchStore, logout } = useAuth();
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const [pendingStoreId, setPendingStoreId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const sortedStores = [...myStores].sort((a, b) => {
    if (a.status === b.status) {
      return a.name.localeCompare(b.name);
    }
    return a.status === 'active' ? -1 : 1;
  });

  const handleSelectStore = async (storeId: number) => {
    setError('');
    setPendingStoreId(storeId);
    try {
      await switchStore(storeId);
      navigate('/');
    } catch {
      setError('Could not open that store. Please try again.');
    } finally {
      setPendingStoreId(null);
    }
  };

  return (
    <div className="min-h-screen bg-navy-900 px-4 py-10 sm:px-6">
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
        animate={prefersReducedMotion ? {} : { opacity: 1, y: 0 }}
        className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-4xl items-center"
      >
        <div className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl bg-white/8 p-8 text-white backdrop-blur">
            <div className="mb-10">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-blue-300">
                Choose Store
              </p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight">
                Pick the store for this tab
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300">
                You&apos;re signed in as {user?.username}. Select the store or business you want to
                work in right now. You can leave the current store later without signing out
                completely.
              </p>
            </div>

            <div className="grid gap-3">
              {sortedStores.map(store => {
                const disabled = store.status !== 'active';
                const isPending = pendingStoreId === store.id;
                return (
                  <button
                    key={store.id}
                    type="button"
                    disabled={disabled || isPending}
                    onClick={() => void handleSelectStore(store.id)}
                    className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {store.logo ? (
                      <img
                        src={store.logo}
                        alt={store.name}
                        className="h-12 w-12 rounded-xl border border-white/10 bg-white object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-white">
                        <Store size={20} />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold text-white">{store.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                        {store.role} • {store.status}
                      </p>
                    </div>

                    <ArrowRight size={18} className="text-slate-400" />
                  </button>
                );
              })}
            </div>

            {error && (
              <div className="mt-4 rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            )}
          </div>

          <div className="rounded-3xl bg-white p-8 shadow-2xl">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-navy-50 text-navy-800">
                <Building2 size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Account session stays active</h2>
                <p className="text-sm text-slate-500">Store selection is now handled per tab.</p>
              </div>
            </div>

            <div className="space-y-3 text-sm text-slate-600">
              <p>This keeps multi-store work lighter without making normal sign-in more complex.</p>
              <p>Single-store users continue to use the app the same way they do today.</p>
              <p>Use full sign-out only when you want to end the browser session completely.</p>
            </div>

            <button
              type="button"
              onClick={() => void logout()}
              className="mt-8 inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <LogOut size={16} />
              Sign Out Completely
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
