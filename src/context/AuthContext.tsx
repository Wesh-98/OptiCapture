import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  clearActiveStoreId,
  clearStoreScopedSessionState,
  getActiveStoreId,
  setActiveStoreId as persistActiveStoreId,
} from '../lib/apiFetch';

interface User {
  id: number;
  username: string;
  role: 'owner' | 'taker' | 'superadmin' | null;
  store_id: number | null;
  store_name: string | null;
  store_logo?: string | null;
  must_reset_password: boolean;
  needs_store_selection: boolean;
}

interface StoreAccess {
  id: number;
  name: string;
  logo: string | null;
  status: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  login: (user: User) => Promise<void>;
  logout: () => Promise<void>;
  leaveCurrentStore: () => Promise<void>;
  isLoading: boolean;
  myStores: StoreAccess[];
  switchStore: (storeId: number) => Promise<void>;
  refreshUser: () => Promise<User | null>;
  activeStoreId: number | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [myStores, setMyStores] = useState<StoreAccess[]>([]);
  const [activeStoreId, setActiveStoreIdState] = useState<number | null>(() => getActiveStoreId());
  const navigate = useNavigate();

  const loadMyStores = useCallback(async () => {
    const storesRes = await fetch('/api/auth/my-stores', { credentials: 'include' });
    if (!storesRes.ok) {
      setMyStores([]);
      return [];
    }

    const stores = (await storesRes.json().catch(() => [])) as StoreAccess[];
    const normalized = Array.isArray(stores) ? stores : [];
    setMyStores(normalized);
    return normalized;
  }, []);

  const refreshUser = useCallback(async () => {
    let res = await fetch('/api/auth/me', { credentials: 'include' });

    // If the remembered tab-scoped store is no longer valid, drop it and retry
    // the account-level /me endpoint so multi-store users can recover cleanly.
    if ((res.status === 403 || res.status === 409) && getActiveStoreId() != null) {
      clearActiveStoreId();
      clearStoreScopedSessionState();
      setActiveStoreIdState(null);
      res = await fetch('/api/auth/me', { credentials: 'include' });
    }

    if (!res.ok) {
      setUser(null);
      setMyStores([]);
      setActiveStoreIdState(getActiveStoreId());
      return null;
    }

    const userData = (await res.json()) as User;
    setUser(userData);
    await loadMyStores();

    if (userData.store_id != null) {
      setActiveStoreIdState(userData.store_id);
    } else if (userData.needs_store_selection) {
      clearActiveStoreId();
      setActiveStoreIdState(null);
    }

    return userData;
  }, [loadMyStores]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        await refreshUser();
      } catch (error) {
        console.error('Auth check failed', error);
      } finally {
        setIsLoading(false);
      }
    };

    void checkAuth();
  }, [refreshUser]);

  const login = useCallback(
    async (userData: User) => {
      setUser(userData);

      if (userData.role !== 'superadmin' && userData.store_id != null) {
        persistActiveStoreId(userData.store_id);
        setActiveStoreIdState(userData.store_id);
      }

      const refreshedUser = await refreshUser().catch(() => null);
      const nextUser = refreshedUser ?? userData;

      if (nextUser.role === 'superadmin') {
        navigate('/admin');
        return;
      }

      if (nextUser.needs_store_selection) {
        navigate('/choose-store');
        return;
      }

      if (nextUser.must_reset_password) {
        navigate('/settings');
        return;
      }

      navigate('/');
    },
    [navigate, refreshUser]
  );

  const switchStore = useCallback(
    async (storeId: number) => {
      const res = await fetch('/api/auth/switch-store', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId }),
      });
      if (!res.ok) throw new Error('Failed to switch store');

      persistActiveStoreId(storeId);
      setActiveStoreIdState(storeId);
      // Scan session state is store-scoped, so clear it before the next view
      // hydrates under the newly selected store.
      clearStoreScopedSessionState();
      await refreshUser().catch(() => null);
    },
    [refreshUser]
  );

  const leaveCurrentStore = useCallback(async () => {
    // "Leave current store" intentionally keeps the account session alive and
    // only clears the tab's active store selection.
    clearActiveStoreId();
    clearStoreScopedSessionState();
    setActiveStoreIdState(null);
    await refreshUser().catch(() => null);
    navigate('/choose-store');
  }, [navigate, refreshUser]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    clearActiveStoreId();
    clearStoreScopedSessionState();
    setUser(null);
    setMyStores([]);
    setActiveStoreIdState(null);
    navigate('/login');
  }, [navigate]);

  const value = useMemo(
    () => ({
      user,
      login,
      logout,
      leaveCurrentStore,
      isLoading,
      myStores,
      switchStore,
      refreshUser,
      activeStoreId,
    }),
    [
      user,
      login,
      logout,
      leaveCurrentStore,
      isLoading,
      myStores,
      switchStore,
      refreshUser,
      activeStoreId,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
