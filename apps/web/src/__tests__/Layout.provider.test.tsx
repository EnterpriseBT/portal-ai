import { renderHook, act, waitFor } from "./test-utils";
import React from "react";
import { ThemeProvider } from "@portalai/core/ui";
import {
  LayoutProvider,
  SidebarState,
  SIDEBAR_STATES,
} from "../providers/Layout.provider";
import { useLayout } from "../utils/layout.util";

const STORAGE_KEY = "sidebar-state";

const createWrapper = () => {
  return ({ children }: { children: React.ReactNode }) => (
    <ThemeProvider defaultTheme="brand">
      <LayoutProvider>{children as React.ReactElement}</LayoutProvider>
    </ThemeProvider>
  );
};

describe("LayoutProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe("Initialization", () => {
    it("should default to collapsed when localStorage is empty", () => {
      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      expect(result.current.sidebarState).toBe("collapsed");
    });

    it("should initialize from localStorage when a valid value is stored", () => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify("expanded:active"));

      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      expect(result.current.sidebarState).toBe("expanded:active");
    });

    it("should fall back to default when localStorage has an invalid value", () => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify("invalid"));

      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      expect(result.current.sidebarState).toBe("collapsed");
    });
  });

  describe("setSidebarState", () => {
    it.each(SIDEBAR_STATES)(
      "should update state to %s",
      (state: SidebarState) => {
        const { result } = renderHook(() => useLayout(), {
          wrapper: createWrapper(),
        });

        act(() => {
          result.current.setSidebarState(state);
        });

        expect(result.current.sidebarState).toBe(state);
      }
    );

    it("should persist state changes to localStorage", async () => {
      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setSidebarState("collapsed");
      });

      await waitFor(() => {
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
          JSON.stringify("collapsed")
        );
      });
    });
  });

  describe("Boolean flags", () => {
    it("should set correct flags for collapsed state", () => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify("collapsed"));

      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isCollapsed).toBe(true);
      expect(result.current.isExpanded).toBe(false);
      expect(result.current.isExpandedActive).toBe(false);
      expect(result.current.isExpandedPassive).toBe(false);
    });

    it("should set correct flags for expanded:active state", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify("expanded:active")
      );

      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isCollapsed).toBe(false);
      expect(result.current.isExpanded).toBe(true);
      expect(result.current.isExpandedActive).toBe(true);
      expect(result.current.isExpandedPassive).toBe(false);
    });

    it("should set correct flags for expanded:passive state", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify("expanded:passive")
      );

      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isCollapsed).toBe(false);
      expect(result.current.isExpanded).toBe(true);
      expect(result.current.isExpandedActive).toBe(false);
      expect(result.current.isExpandedPassive).toBe(true);
    });

    it("should update boolean flags when state changes", () => {
      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      // Default is collapsed
      expect(result.current.isCollapsed).toBe(true);

      act(() => {
        result.current.setSidebarState("expanded:active");
      });

      expect(result.current.isExpandedActive).toBe(true);
      expect(result.current.isCollapsed).toBe(false);

      act(() => {
        result.current.setSidebarState("expanded:passive");
      });

      expect(result.current.isExpandedPassive).toBe(true);
      expect(result.current.isCollapsed).toBe(false);
    });
  });

  describe("useLayout without provider", () => {
    it("should throw when used outside LayoutProvider", () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <ThemeProvider defaultTheme="brand">
          {children as React.ReactElement}
        </ThemeProvider>
      );

      expect(() =>
        renderHook(() => useLayout(), { wrapper })
      ).toThrow("useLayout must be used within a LayoutProvider");
    });
  });
});
