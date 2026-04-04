import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface User {
  id: number;
  username: string;
  role: 'owner' | 'taker' | 'superadmin';
  store_id: number;
  store_name: string;
  store_logo?: string | null;
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
  login: (user: User) => void;
  logout: () => void;
  isLoading: boolean;
  myStores: StoreAccess[];
  switchStore: (storeId: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [myStores, setMyStores] = useState<StoreAccess[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
          const userData = await res.json();
          setUser(userData);
          const storesRes = await fetch('/api/auth/my-stores', { credentials: 'include' });
          if (storesRes.ok) setMyStores(await storesRes.json());
        }
      } catch (error) {
        console.error('Auth check failed', error);
      } finally {
        setIsLoading(false);
      }
    };
    checkAuth();
  }, []);

  const login = (userData: User) => {
    setUser(userData);
    navigate(userData.role === 'superadmin' ? '/admin' : '/');
  };

  const switchStore = async (storeId: number) => {
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
    // Re-fetch user to get updated JWT context
    const meRes = await fetch('/api/auth/me', { credentials: 'include' });
    if (meRes.ok) {
      const userData = await meRes.json();
      setUser(userData);
    }
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    sessionStorage.removeItem('scan_session_id');
    sessionStorage.removeItem('scan_otp');
    sessionStorage.removeItem('scan_store_id');
    setUser(null);
    setMyStores([]);
    navigate('/login');
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading, myStores, switchStore }}>
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
