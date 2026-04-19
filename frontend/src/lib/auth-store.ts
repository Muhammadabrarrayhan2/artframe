import { create } from "zustand";
import { api, writeToken, type UserOut } from "./api";

type AuthState = {
  user: UserOut | null;
  loading: boolean;
  hydrated: boolean;
  setToken: (t: string) => Promise<void>;
  refresh: () => Promise<UserOut | null>;
  logout: () => Promise<void>;
};

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: false,
  hydrated: false,

  setToken: async (token: string) => {
    writeToken(token);
    set({ loading: true });
    try {
      const user = await api.me();
      set({ user, loading: false, hydrated: true });
    } catch {
      writeToken(null);
      set({ user: null, loading: false, hydrated: true });
    }
  },

  refresh: async () => {
    set({ loading: true });
    try {
      const user = await api.me();
      set({ user, loading: false, hydrated: true });
      return user;
    } catch {
      writeToken(null);
      set({ user: null, loading: false, hydrated: true });
      return null;
    }
  },

  logout: async () => {
    try {
      await api.logout();
    } catch {
      // ignore — we're clearing locally anyway
    }
    writeToken(null);
    set({ user: null });
    // Hard redirect to prevent back-button recovery of protected pages
    if (typeof window !== "undefined") {
      window.location.replace("/login");
    }
  },
}));
