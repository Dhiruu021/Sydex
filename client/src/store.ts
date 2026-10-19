import { create } from "zustand";
import type { UserProfile } from "@sydex/shared";
import { setAccessToken } from "./api";

interface AuthState {
  user: UserProfile | null;
  ready: boolean;
  setSession: (token: string, user: UserProfile) => void;
  setUser: (user: UserProfile) => void;
  clearSession: () => void;
  setReady: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  ready: false,
  setSession: (token, user) => {
    setAccessToken(token);
    set({ user });
  },
  setUser: (user) => set({ user }),
  clearSession: () => {
    setAccessToken(null);
    set({ user: null });
  },
  setReady: () => set({ ready: true })
}));
