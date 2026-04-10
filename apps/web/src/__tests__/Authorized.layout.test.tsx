import { jest } from "@jest/globals";
import React from "react";
import { render, screen } from "./test-utils";
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

  it("should render Portals.ai title in header", () => {
    render(
      <AuthorizedLayout>
        <div>Test Content</div>
      </AuthorizedLayout>
    );
    expect(screen.getByText("Portals.ai")).toBeInTheDocument();
  });
});
