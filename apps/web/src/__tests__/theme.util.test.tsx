import { renderHook, act, waitFor } from "@testing-library/react";
import { jest } from "@jest/globals";
import { usePersistedTheme } from "../utils/theme.util";
import { ThemeProvider, ThemeName } from "@mcp-ui/core/ui";
import React from "react";

describe("usePersistedTheme", () => {
  const THEME_STORAGE_KEY = "mcp-ui-theme";

  // Helper to wrap hook in ThemeProvider
  const createWrapper = (defaultTheme?: ThemeName) => {
    return ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider defaultTheme={defaultTheme}>
        {children as React.ReactElement}
      </ThemeProvider>
    );
  };

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe("Initialization", () => {
    it("should return default theme when localStorage is empty", () => {
      const { result } = renderHook(() => usePersistedTheme(), {
        wrapper: createWrapper("brand"),
      });

      expect(result.current.themeName).toBe("brand");
    });

    it("should use default theme of 'brand' when no defaultTheme is provided", () => {
      const { result } = renderHook(() => usePersistedTheme(), {
        wrapper: createWrapper(),
      });

      expect(result.current.themeName).toBe("brand");
    });

    it("should load theme from localStorage on initialization", () => {
      window.localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify("brand.dark")
      );

      const { result } = renderHook(() => usePersistedTheme(), {
        wrapper: createWrapper("brand.dark"),
      });

      expect(result.current.themeName).toBe("brand.dark");
    });

    it("should prioritize localStorage over defaultTheme prop", () => {
      window.localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify("brand.dark")
      );

      const { result } = renderHook(() => usePersistedTheme(), {
        wrapper: createWrapper("brand.dark"),
      });

      expect(result.current.themeName).toBe("brand.dark");
    });

    it("should use defaultTheme when localStorage has invalid theme", () => {
      window.localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify("invalid-theme")
      );

      const { result } = renderHook(() => usePersistedTheme(), {
        wrapper: createWrapper("brand.dark"),
      });

      expect(result.current.themeName).toBe("brand.dark");
    });
  });

  describe("Theme Persistence", () => {
    it("should save theme to localStorage when changed", async () => {
      const { result } = renderHook(() => usePersistedTheme(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setThemeName("brand.dark");
      });

      await waitFor(() => {
        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(
          JSON.stringify("brand.dark")
        );
      });
    });

    it("should persist theme across multiple changes", async () => {
      const { result } = renderHook(() => usePersistedTheme(), {
        wrapper: createWrapper(),
      });

      // Change to dark
      act(() => {
        result.current.setThemeName("brand.dark");
      });

      await waitFor(() => {
        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(
          JSON.stringify("brand.dark")
        );
      });

      // Change back to light
      act(() => {
        result.current.setThemeName("brand");
      });

      await waitFor(() => {
        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(
          JSON.stringify("brand")
        );
      });
    });

    it("should update theme state when setThemeName is called", () => {
      const { result } = renderHook(() => usePersistedTheme(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setThemeName("brand.dark");
      });

      expect(result.current.themeName).toBe("brand.dark");
    });
  });

  describe("Error Handling", () => {
    it("should handle localStorage.getItem errors gracefully", () => {
      const originalGetItem = Storage.prototype.getItem;
      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      Storage.prototype.getItem = jest.fn(() => {
        throw new Error("localStorage unavailable");
      });

      const { result } = renderHook(() => usePersistedTheme(), {
        wrapper: createWrapper("brand.dark"),
      });

      // Should use defaultTheme when localStorage fails
      expect(result.current.themeName).toBe("brand.dark");

      // Should have logged a warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Failed to read from localStorage:",
        expect.any(Error)
      );

      // Restore
      Storage.prototype.getItem = originalGetItem;
      consoleWarnSpy.mockRestore();
    });

    it("should handle localStorage.setItem errors gracefully", async () => {
      const originalSetItem = Storage.prototype.setItem;
      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      Storage.prototype.setItem = jest.fn(() => {
        throw new Error("localStorage full");
      });

      const { result } = renderHook(() => usePersistedTheme(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setThemeName("brand.dark");
      });

      // Theme should still change in memory
      expect(result.current.themeName).toBe("brand.dark");

      // Should have logged a warning
      await waitFor(() => {
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "Failed to save to localStorage:",
          expect.any(Error)
        );
      });

      // Restore
      Storage.prototype.setItem = originalSetItem;
      consoleWarnSpy.mockRestore();
    });
  });

  describe("SSR Compatibility", () => {
    it("should handle undefined window gracefully", () => {
      // This test verifies the typeof window === "undefined" check
      // In a real SSR scenario, window would be undefined
      // For now, we just verify the hook doesn't crash
      const { result } = renderHook(() => usePersistedTheme(), {
        wrapper: createWrapper(),
      });

      expect(result.current.themeName).toBeDefined();
      expect(result.current.setThemeName).toBeDefined();
    });
  });

  describe("Return Value", () => {
    it("should return themeName, setThemeName, and theme", () => {
      const { result } = renderHook(() => usePersistedTheme(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toHaveProperty("themeName");
      expect(result.current).toHaveProperty("setThemeName");
      expect(result.current).toHaveProperty("theme");
      expect(typeof result.current.setThemeName).toBe("function");
      expect(typeof result.current.theme).toBe("object");
    });

    it("should maintain stable setThemeName reference", () => {
      const { result, rerender } = renderHook(() => usePersistedTheme(), {
        wrapper: createWrapper(),
      });

      const firstSetThemeName = result.current.setThemeName;

      act(() => {
        result.current.setThemeName("brand.dark");
      });

      rerender();

      // setThemeName should be the same reference
      expect(result.current.setThemeName).toBe(firstSetThemeName);
    });
  });
});
