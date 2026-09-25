import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { authApi, clearToken, getToken, setToken } from "../services/api.ts";
import type { OAuthProvider, User } from "../types.ts";

interface AuthContextValue {
  user: User | null;
  token: string | null;
  initializing: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  loginWithOAuth: (provider: OAuthProvider, code: string, state: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const stored = getToken();
      if (!stored) {
        setInitializing(false);
        return;
      }
      try {
        const me = await authApi.me();
        if (!cancelled) {
          setUser(me);
          setTokenState(stored);
        }
      } catch {
        clearToken();
        if (!cancelled) {
          setTokenState(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await authApi.login({ identifier, password });
    setToken(res.access_token);
    setTokenState(res.access_token);
    setUser(res.user);
  }, []);

  const register = useCallback(
    async (email: string, username: string, password: string) => {
      const res = await authApi.register({ email, username, password });
      setToken(res.access_token);
      setTokenState(res.access_token);
      setUser(res.user);
    },
    [],
  );

  const loginWithOAuth = useCallback(
    async (provider: OAuthProvider, code: string, state: string) => {
      const res = await authApi.oauthCallback(provider, code, state);
      setToken(res.access_token);
      setTokenState(res.access_token);
      setUser(res.user);
    },
    [],
  );

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, token, initializing, login, register, loginWithOAuth, logout }),
    [user, token, initializing, login, register, loginWithOAuth, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}