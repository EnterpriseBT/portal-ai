import { renderHook, act } from "./test-utils";
import React from "react";
import { ThemeProvider } from "@mcp-ui/core/ui";
import { LayoutProvider, SidebarState } from "../providers/Layout.provider";
import { useLayout } from "../utils/layout.util";

const STORAGE_KEY = "sidebar-state";

const createWrapper = () => {
  return ({ children }: { children: React.ReactNode }) => (
    <ThemeProvider defaultTheme="brand">
      <LayoutProvider>{children as React.ReactElement}</LayoutProvider>
    </ThemeProvider>
  );
};

/**
 * Override window.matchMedia so that useMediaQuery returns true
 * only for queries that match the given breakpoint simulation.
 *
 * MUI default breakpoints: xs=0, sm=600, md=900, lg=1200, xl=1536
 * - mobile:  down("sm")    → max-width <600
 * - tablet:  between("sm","md") → min-width >=600 AND max-width <900
 * - desktop: up("md")      → min-width >=900
 */
const mockBreakpoint = (breakpoint: "mobile" | "tablet" | "desktop") => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => {
      let matches = false;
      if (breakpoint === "mobile") {
        // down("sm") produces a max-width-only query (no min-width)
        matches =
          query.includes("max-width") && !query.includes("min-width");
      } else if (breakpoint === "tablet") {
        // between("sm","md") produces a query with both min-width and max-width
        matches =
          query.includes("min-width") && query.includes("max-width");
      } else if (breakpoint === "desktop") {
        // up("md") produces a min-width query (without max-width)
        matches =
          query.includes("min-width") && !query.includes("max-width");
      }
      return {
        matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
    },
  });
};

const resetMatchMedia = () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
};

describe("useLayout", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetMatchMedia();
  });

  afterEach(() => {
    window.localStorage.clear();
    resetMatchMedia();
  });

  describe("breakpoint flags", () => {
    it("should set isMobile when viewport is mobile", () => {
      mockBreakpoint("mobile");

      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isMobile).toBe(true);
      expect(result.current.isTablet).toBe(false);
      expect(result.current.isDesktop).toBe(false);
    });

    it("should set isTablet when viewport is tablet", () => {
      mockBreakpoint("tablet");

      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isMobile).toBe(false);
      expect(result.current.isTablet).toBe(true);
      expect(result.current.isDesktop).toBe(false);
    });

    it("should set isDesktop when viewport is desktop", () => {
      mockBreakpoint("desktop");

      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isMobile).toBe(false);
      expect(result.current.isTablet).toBe(false);
      expect(result.current.isDesktop).toBe(true);
    });
  });

  describe("breakpoints object", () => {
    it("should expose breakpoints from theme", () => {
      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      expect(result.current.breakpoints).toBeDefined();
      expect(typeof result.current.breakpoints.up).toBe("function");
      expect(typeof result.current.breakpoints.down).toBe("function");
      expect(typeof result.current.breakpoints.between).toBe("function");
    });
  });

  describe("mobile + sidebar combinations", () => {
    it.each<[SidebarState, Record<string, boolean>]>([
      [
        "collapsed",
        {
          isMobileCollapsed: true,
          isMobileExpanded: false,
          isMobileExpandedActive: false,
          isMobileExpandedPassive: false,
        },
      ],
      [
        "expanded:active",
        {
          isMobileCollapsed: false,
          isMobileExpanded: true,
          isMobileExpandedActive: true,
          isMobileExpandedPassive: false,
        },
      ],
      [
        "expanded:passive",
        {
          isMobileCollapsed: false,
          isMobileExpanded: true,
          isMobileExpandedActive: false,
          isMobileExpandedPassive: true,
        },
      ],
    ])(
      "should set correct mobile flags for %s sidebar",
      (sidebarState, expected) => {
        mockBreakpoint("mobile");
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(sidebarState)
        );

        const { result } = renderHook(() => useLayout(), {
          wrapper: createWrapper(),
        });

        expect(result.current.isMobileCollapsed).toBe(
          expected.isMobileCollapsed
        );
        expect(result.current.isMobileExpanded).toBe(
          expected.isMobileExpanded
        );
        expect(result.current.isMobileExpandedActive).toBe(
          expected.isMobileExpandedActive
        );
        expect(result.current.isMobileExpandedPassive).toBe(
          expected.isMobileExpandedPassive
        );
      }
    );
  });

  describe("tablet + sidebar combinations", () => {
    it.each<[SidebarState, Record<string, boolean>]>([
      [
        "collapsed",
        {
          isTabletCollapsed: true,
          isTabletExpanded: false,
          isTabletExpandedActive: false,
          isTabletExpandedPassive: false,
        },
      ],
      [
        "expanded:active",
        {
          isTabletCollapsed: false,
          isTabletExpanded: true,
          isTabletExpandedActive: true,
          isTabletExpandedPassive: false,
        },
      ],
      [
        "expanded:passive",
        {
          isTabletCollapsed: false,
          isTabletExpanded: true,
          isTabletExpandedActive: false,
          isTabletExpandedPassive: true,
        },
      ],
    ])(
      "should set correct tablet flags for %s sidebar",
      (sidebarState, expected) => {
        mockBreakpoint("tablet");
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(sidebarState)
        );

        const { result } = renderHook(() => useLayout(), {
          wrapper: createWrapper(),
        });

        expect(result.current.isTabletCollapsed).toBe(
          expected.isTabletCollapsed
        );
        expect(result.current.isTabletExpanded).toBe(
          expected.isTabletExpanded
        );
        expect(result.current.isTabletExpandedActive).toBe(
          expected.isTabletExpandedActive
        );
        expect(result.current.isTabletExpandedPassive).toBe(
          expected.isTabletExpandedPassive
        );
      }
    );
  });

  describe("desktop + sidebar combinations", () => {
    it.each<[SidebarState, Record<string, boolean>]>([
      [
        "collapsed",
        {
          isDesktopCollapsed: true,
          isDesktopExpanded: false,
          isDesktopExpandedActive: false,
          isDesktopExpandedPassive: false,
        },
      ],
      [
        "expanded:active",
        {
          isDesktopCollapsed: false,
          isDesktopExpanded: true,
          isDesktopExpandedActive: true,
          isDesktopExpandedPassive: false,
        },
      ],
      [
        "expanded:passive",
        {
          isDesktopCollapsed: false,
          isDesktopExpanded: true,
          isDesktopExpandedActive: false,
          isDesktopExpandedPassive: true,
        },
      ],
    ])(
      "should set correct desktop flags for %s sidebar",
      (sidebarState, expected) => {
        mockBreakpoint("desktop");
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(sidebarState)
        );

        const { result } = renderHook(() => useLayout(), {
          wrapper: createWrapper(),
        });

        expect(result.current.isDesktopCollapsed).toBe(
          expected.isDesktopCollapsed
        );
        expect(result.current.isDesktopExpanded).toBe(
          expected.isDesktopExpanded
        );
        expect(result.current.isDesktopExpandedActive).toBe(
          expected.isDesktopExpandedActive
        );
        expect(result.current.isDesktopExpandedPassive).toBe(
          expected.isDesktopExpandedPassive
        );
      }
    );
  });

  describe("combination flags are false when breakpoint does not match", () => {
    it("should have all combination flags false when no breakpoint matches", () => {
      // Default matchMedia returns false for all queries
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify("expanded:active")
      );

      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isMobileCollapsed).toBe(false);
      expect(result.current.isMobileExpanded).toBe(false);
      expect(result.current.isMobileExpandedActive).toBe(false);
      expect(result.current.isMobileExpandedPassive).toBe(false);
      expect(result.current.isTabletCollapsed).toBe(false);
      expect(result.current.isTabletExpanded).toBe(false);
      expect(result.current.isTabletExpandedActive).toBe(false);
      expect(result.current.isTabletExpandedPassive).toBe(false);
      expect(result.current.isDesktopCollapsed).toBe(false);
      expect(result.current.isDesktopExpanded).toBe(false);
      expect(result.current.isDesktopExpandedActive).toBe(false);
      expect(result.current.isDesktopExpandedPassive).toBe(false);
    });
  });

  describe("combination flags update with sidebar state changes", () => {
    it("should update combination flags when sidebar state changes", () => {
      mockBreakpoint("desktop");

      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      // Default: collapsed
      expect(result.current.isDesktopCollapsed).toBe(true);
      expect(result.current.isDesktopExpandedActive).toBe(false);

      act(() => {
        result.current.setSidebarState("expanded:active");
      });

      expect(result.current.isDesktopExpandedActive).toBe(true);
      expect(result.current.isDesktopCollapsed).toBe(false);
      expect(result.current.isDesktopExpandedPassive).toBe(false);

      act(() => {
        result.current.setSidebarState("expanded:passive");
      });

      expect(result.current.isDesktopExpandedPassive).toBe(true);
      expect(result.current.isDesktopCollapsed).toBe(false);
      expect(result.current.isDesktopExpandedActive).toBe(false);
    });
  });

  describe("toggle", () => {
    it("should expand actively from collapsed by default", () => {
      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      // Default is collapsed
      expect(result.current.isCollapsed).toBe(true);

      act(() => {
        result.current.toggle();
      });

      expect(result.current.sidebarState).toBe("expanded:active");
    });

    it("should expand passively from collapsed when active is false", () => {
      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isCollapsed).toBe(true);

      act(() => {
        result.current.toggle({ active: false });
      });

      expect(result.current.sidebarState).toBe("expanded:passive");
    });

    it("should collapse from expanded:active", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify("expanded:active")
      );

      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isExpandedActive).toBe(true);

      act(() => {
        result.current.toggle();
      });

      expect(result.current.sidebarState).toBe("collapsed");
    });

    it("should collapse from expanded:passive", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify("expanded:passive")
      );

      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isExpandedPassive).toBe(true);

      act(() => {
        result.current.toggle();
      });

      expect(result.current.sidebarState).toBe("collapsed");
    });

    it("should cycle collapsed -> expanded:active -> collapsed", () => {
      const { result } = renderHook(() => useLayout(), {
        wrapper: createWrapper(),
      });

      expect(result.current.sidebarState).toBe("collapsed");

      act(() => {
        result.current.toggle();
      });

      expect(result.current.sidebarState).toBe("expanded:active");

      act(() => {
        result.current.toggle();
      });

      expect(result.current.sidebarState).toBe("collapsed");
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
