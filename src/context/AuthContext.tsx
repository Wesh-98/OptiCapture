import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface User {
  id: number;
  username: string;
  role: 'owner' | 'taker' | 'superadmin';
  store_id: number;
  store_name: string;
  store_logo?: string | null;
  must_reset_password: boolean;
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
  logout: () => void;
  isLoading: boolean;
  myStores: StoreAccess[];
  switchStore: (storeId: number) => Promise<void>;
  refreshUser: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [myStores, setMyStores] = useState<StoreAccess[]>([]);
  const navigate = useNavigate();

  const loadMyStores = useCallback(async () => {
    const storesRes = await fetch('/api/auth/my-stores', { credentials: 'include' });
    if (!storesRes.ok) {
      setMyStores([]);
      return [];
    }

    const stores = (await storesRes.json().catch(() => [])) as StoreAccess[];
    setMyStores(Array.isArray(stores) ? stores : []);
    return Array.isArray(stores) ? stores : [];
  }, []);

  const refreshUser = useCallback(async () => {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) {
      setUser(null);
      setMyStores([]);
      return null;
    }

    const userData = (await res.json()) as User;
    setUser(userData);
    await loadMyStores();
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

  const login = useCallback(async (userData: User) => {
    setUser(userData);
    const refreshedUser = await refreshUser().catch(() => null);
    const nextUser = refreshedUser ?? userData;

    // Newly created and reset accounts should land in Settings before the rest of the app opens up.
    if (nextUser.must_reset_password) {
      navigate('/settings');
      return;
    }

    navigate(nextUser.role === 'superadmin' ? '/admin' : '/');
  }, [navigate, refreshUser]);

  const switchStore = useCallback(async (storeId: number) => {
    const res = await fetch('/api/auth/switch-store', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: storeId }),
    });
    if (!res.ok) throw new Error('Failed to switch store');
    await res.json();
    // Clear scan session so a new one is created for the switched store
    sessionStorage.removeItem('scan_session_id');
    sessionStorage.removeItem('scan_otp');
    sessionStorage.removeItem('scan_store_id');
    await refreshUser().catch(() => null);
  }, [refreshUser]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    sessionStorage.removeItem('scan_session_id');
    sessionStorage.removeItem('scan_otp');
    sessionStorage.removeItem('scan_store_id');
    setUser(null);
    setMyStores([]);
    navigate('/login');
  }, [navigate]);

  const value = useMemo(
    () => ({ user, login, logout, isLoading, myStores, switchStore, refreshUser }),
    [user, login, logout, isLoading, myStores, switchStore, refreshUser]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
