// Theme store (approved fork: Zustand over React Context for local UI
// state — see HANDOFF.md's Phase 4 design doc). Deliberately the ONLY
// state this store owns; wallet/chain state lives in Wagmi, server data
// in React Query, per the same design doc's state-management split.
//
// Persistence key ("dvs-theme") MUST match index.html's inline bootstrap
// script exactly — that script runs before React mounts and sets the
// `dark` class on <html> synchronously to avoid a flash of the wrong
// theme; this store takes over from there and keeps both in sync on every
// toggle.
import { create } from "zustand";

export type Theme = "light" | "dark";

const STORAGE_KEY = "dvs-theme";

function applyThemeClass(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function readInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // localStorage unavailable (private mode, etc.) — fall through to
    // system preference, same as index.html's bootstrap script.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readInitialTheme(),
  setTheme: (theme) => {
    applyThemeClass(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Non-fatal — theme just won't persist across reloads this session.
    }
    set({ theme });
  },
  toggleTheme: () => {
    get().setTheme(get().theme === "dark" ? "light" : "dark");
  },
}));
