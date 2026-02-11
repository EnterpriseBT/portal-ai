import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { AuthorizedLayout } from "../layouts/Authorized.layout";
import { Auth0Provider } from "@auth0/auth0-react";

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

  it("should render MCP UI title in header", () => {
    render(
      <AuthorizedLayout>
        <div>Test Content</div>
      </AuthorizedLayout>
    );
    expect(screen.getByText("MCP UI")).toBeInTheDocument();
  });
});
