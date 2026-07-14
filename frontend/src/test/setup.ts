import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// globals:false (vite.config.ts) means Testing Library's own automatic
// cleanup registration never fires (it only self-registers when it
// detects global `afterEach`), so every test file with more than one
// `render()` leaks DOM across tests without this.
afterEach(() => {
  cleanup();
});

// jsdom does not implement window.matchMedia — themeStore.ts's
// readInitialTheme() calls it unconditionally as a fallback when
// localStorage has no stored preference. Without this polyfill every test
// importing themeStore (even indirectly, via a component) throws at
// import time, not just tests that exercise the system-preference path.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
