import { jest } from "@jest/globals";
import React from "react";

const mockAuth0Provider = {
  user: { name: "Test User", picture: "https://example.com/pic.jpg" },
  logout: () => {},
  isAuthenticated: true,
  isLoading: false,
};

// Mock useAuth0 hook
jest.mock("@auth0/auth0-react", () => ({
  Auth0Provider: ({ children }: { children: React.ReactNode }) => children,
  useAuth0: () => mockAuth0Provider,
}));

// Mock sdk to avoid import.meta.env in api.util.ts
jest.mock("../api/sdk", () => ({
  sdk: {
    auth: {
      session: () => ({
        user: { name: "Test User", picture: "https://example.com/pic.jpg" },
        isAuthenticated: true,
        isLoading: false,
        error: undefined,
      }),
      logout: () => ({ logout: jest.fn() }),
    },
    organizations: {
      current: () => ({ data: undefined }),
    },
    // #1075: the header's Open Portal button reads stations and portals.
    stations: {
      get: () => ({ data: undefined, isPending: false }),
      list: () => ({ data: { stations: [] }, isPending: false }),
    },
    portals: {
      list: () => ({ data: { portals: [] }, isPending: false }),
      create: () => ({
        mutate: jest.fn(),
        reset: jest.fn(),
        isPending: false,
        error: null,
      }),
    },
  },
  queryKeys: { portals: { root: ["portals"] } },
}));

// #1075: the header's Open Portal button is gated; here the caller may
// start portals. An ESM mock, so the modules below import after it.
jest.unstable_mockModule("../utils/use-create-gate.util", () => ({
  useCreateGate: () => ({ kind: "allow" }),
}));

const { render, screen, waitFor, within, expectNoAxeViolations } =
  await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { AuthorizedLayout } = await import("../layouts/Authorized.layout");

describe("AuthorizedLayout", () => {
  it("should render children", () => {
    render(
      <AuthorizedLayout>
        <div>Test Content</div>
      </AuthorizedLayout>
    );
    expect(screen.getByText("Test Content")).toBeInTheDocument();
  });

  it("should render header", () => {
    render(
      <AuthorizedLayout>
        <div>Test Content</div>
      </AuthorizedLayout>
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("should render Portals AI title in header", () => {
    render(
      <AuthorizedLayout>
        <div>Test Content</div>
      </AuthorizedLayout>
    );
    expect(screen.getByText("Portals AI")).toBeInTheDocument();
  });

  it("offers Open Portal in the header (#1075)", () => {
    render(
      <AuthorizedLayout>
        <div>Test Content</div>
      </AuthorizedLayout>
    );
    const banner = screen.getByRole("banner");
    // No station on this page, no history, no favorites: it chooses.
    expect(
      within(banner).getByRole("button", { name: "Open Portal" })
    ).toHaveTextContent("Open Portal");
  });

  describe("command palette (#1076)", () => {
    const renderPage = () =>
      render(
        <AuthorizedLayout>
          <div>Test Content</div>
        </AuthorizedLayout>
      );

    it("puts the search box before Open Portal in the header", () => {
      renderPage();
      const buttons = within(screen.getByRole("banner"))
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
      const search = buttons.findIndex((n) => n.includes("Search or run…"));
      const portal = buttons.findIndex((n) => n.includes("Open Portal"));
      expect(search).toBeGreaterThanOrEqual(0);
      expect(search).toBeLessThan(portal);
    });

    it("opens from the header's search box", async () => {
      renderPage();
      await userEvent.click(
        within(screen.getByRole("banner")).getByRole("button", {
          name: /Search or run…/,
        })
      );
      expect(
        await screen.findByRole("dialog", { name: "Search and actions" })
      ).toBeInTheDocument();
    });

    it("opens with Ctrl+K, and Ctrl+K closes it", async () => {
      renderPage();
      await userEvent.keyboard("{Control>}k{/Control}");
      expect(
        await screen.findByRole("dialog", { name: "Search and actions" })
      ).toBeInTheDocument();
      await userEvent.keyboard("{Control>}k{/Control}");
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Search and actions" })
        ).toBeNull()
      );
    });
  });

  describe("landmarks (#797)", () => {
    const renderPage = () =>
      render(
        <AuthorizedLayout>
          <h1>Page</h1>
        </AuthorizedLayout>
      );

    it("has a banner, a Primary navigation and a main holding the page", () => {
      renderPage();
      expect(screen.getByRole("banner")).toBeInTheDocument();
      expect(
        screen.getByRole("navigation", { name: "Primary" })
      ).toBeInTheDocument();
      const main = screen.getByRole("main");
      expect(main).toHaveAttribute("id", "main-content");
      expect(main).toContainElement(
        screen.getByRole("heading", { name: "Page" })
      );
    });

    it("starts with a skip link and puts no heading before the page's", () => {
      renderPage();
      expect(
        screen.getByRole("link", { name: "Skip to main content" })
      ).toBeInTheDocument();
      expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual([
        "Page",
      ]);
    });

    it("has no axe violations", async () => {
      const { container } = renderPage();
      await expectNoAxeViolations(container);
    });
  });
  // Adversarial walk F2: the page behind the open mobile drawer was dimmed
  // and blocked the mouse, but Tab still reached it.
  describe("mobile drawer (#797)", () => {
    const realMatchMedia = window.matchMedia;
    const mobile = (query: string) =>
      ({
        matches: /max-width/.test(query) && !/min-width/.test(query),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
    beforeEach(() => {
      window.matchMedia = mobile;
    });
    afterEach(() => {
      window.matchMedia = realMatchMedia;
      localStorage.removeItem("sidebar-state");
    });

    it("makes main inert while the drawer is open", async () => {
      localStorage.setItem("sidebar-state", JSON.stringify("expanded"));
      render(
        <AuthorizedLayout>
          <div>Test Content</div>
        </AuthorizedLayout>
      );
      await waitFor(() =>
        expect(screen.getByRole("main", { hidden: true })).toHaveAttribute(
          "inert"
        )
      );
    });

    it("shows Open Portal as an icon at phone width (#1075)", () => {
      render(
        <AuthorizedLayout>
          <div>Test Content</div>
        </AuthorizedLayout>
      );
      const button = within(screen.getByRole("banner")).getByRole("button", {
        name: "Open Portal",
      });
      expect(button).not.toHaveTextContent("Open Portal");
    });

    it("shows the palette's search box as an icon at phone width (#1076)", () => {
      render(
        <AuthorizedLayout>
          <div>Test Content</div>
        </AuthorizedLayout>
      );
      const trigger = within(screen.getByRole("banner")).getByRole("button", {
        name: "Search or run…",
      });
      expect(trigger).not.toHaveTextContent("Search or run…");
    });

    it("leaves main reachable while the drawer is closed", async () => {
      localStorage.setItem("sidebar-state", JSON.stringify("collapsed"));
      render(
        <AuthorizedLayout>
          <div>Test Content</div>
        </AuthorizedLayout>
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "toggle sidebar" })
        ).toHaveAttribute("aria-expanded", "false")
      );
      expect(screen.getByRole("main")).not.toHaveAttribute("inert");
    });
  });
});
