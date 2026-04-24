// lib/store.ts — global auth state with Zustand
import { create } from 'zustand';
import type { User } from './api';

interface AuthState {
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,

  setAuth: (user, token) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('pn_token', token);
      localStorage.setItem('pn_user', JSON.stringify(user));
    }
    set({ user, token });
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('pn_token');
      localStorage.removeItem('pn_user');
    }
    set({ user: null, token: null });
  },

  hydrate: () => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('pn_token');
    const userRaw = localStorage.getItem('pn_user');
    if (token && userRaw) {
      try {
        set({ token, user: JSON.parse(userRaw) });
      } catch (_) {}
    }
  },
}));
