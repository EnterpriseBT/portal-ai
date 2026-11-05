import { jest } from "@jest/globals";
import React from "react";
import { render, screen, expectNoAxeViolations } from "./test-utils";
import { AuthorizedLayout } from "../layouts/Authorized.layout";

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
  },
  queryKeys: {},
}));

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
});
