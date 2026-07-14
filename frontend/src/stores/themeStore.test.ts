import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store reads localStorage/matchMedia/document at MODULE LOAD time
// (readInitialTheme() runs inside create()'s initializer), so each test
// that needs a specific starting condition must reset modules and
// re-import fresh — same pattern env.test.ts already uses backend-side
// for its own "parses process.env once at import" singleton (see
// HANDOFF.md's wallet.service.ts bug entry for why this matters).
describe("themeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("defaults to light when nothing is stored and system preference is light", async () => {
    const { useThemeStore } = await import("./themeStore.js");
    expect(useThemeStore.getState().theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("reads a previously stored theme over the system preference", async () => {
    localStorage.setItem("dvs-theme", "dark");
    const { useThemeStore } = await import("./themeStore.js");
    expect(useThemeStore.getState().theme).toBe("dark");
  });

  it("setTheme updates state, persists, and toggles the <html> dark class", async () => {
    const { useThemeStore } = await import("./themeStore.js");
    useThemeStore.getState().setTheme("dark");

    expect(useThemeStore.getState().theme).toBe("dark");
    expect(localStorage.getItem("dvs-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    useThemeStore.getState().setTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("toggleTheme flips between light and dark", async () => {
    const { useThemeStore } = await import("./themeStore.js");
    expect(useThemeStore.getState().theme).toBe("light");
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("dark");
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("light");
  });

  it("falls back to light without throwing if localStorage.setItem throws", async () => {
    const { useThemeStore } = await import("./themeStore.js");
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => useThemeStore.getState().setTheme("dark")).not.toThrow();
    expect(useThemeStore.getState().theme).toBe("dark");
    spy.mockRestore();
  });
});
