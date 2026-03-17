import { jest } from "@jest/globals";
import { render, screen } from "./test-utils";

const mockHandleAuthError = jest.fn();
jest.unstable_mockModule("../utils/auth-error.util", () => ({
  handleAuthError: mockHandleAuthError,
}));

const { AuthorizedUI } = await import("../components/Authorized.component");

// Mock sdk to avoid import.meta.env in api.util.ts
jest.mock("../api/sdk", () => ({
  sdk: {
    auth: {
      session: () => ({
        user: undefined,
        isAuthenticated: false,
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

describe("AuthorizedUI Component", () => {
  const mockChildren = <div>Protected Content</div>;

  beforeEach(() => {
    mockHandleAuthError.mockClear();
  });

  describe("Loading State", () => {
    it("should render LoadingView when loading is true", () => {
      const { container } = render(
        <AuthorizedUI loading={true} error={undefined}>
          {mockChildren}
        </AuthorizedUI>
      );

      expect(container).toMatchSnapshot();
    });

    it("should not render children when loading", () => {
      render(
        <AuthorizedUI loading={true} error={undefined}>
          {mockChildren}
        </AuthorizedUI>
      );

      expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    });
  });

  describe("Error State", () => {
    it("should call handleAuthError and show loading when error is present", () => {
      const mockError = new Error("Authentication failed");
      const { container } = render(
        <AuthorizedUI loading={false} error={mockError}>
          {mockChildren}
        </AuthorizedUI>
      );

      expect(mockHandleAuthError).toHaveBeenCalled();
      expect(container).toMatchSnapshot();
    });

    it("should not render children when there is an error", () => {
      const mockError = new Error("Authentication failed");
      render(
        <AuthorizedUI loading={false} error={mockError}>
          {mockChildren}
        </AuthorizedUI>
      );

      expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    });

    it("should trigger auth error handling on error", () => {
      const mockError = new Error("Custom error message");
      render(
        <AuthorizedUI loading={false} error={mockError}>
          {mockChildren}
        </AuthorizedUI>
      );

      expect(mockHandleAuthError).toHaveBeenCalledTimes(1);
    });
  });

  describe("Authenticated State", () => {
    it("should render children when not loading and no error", () => {
      const { container } = render(
        <AuthorizedUI loading={false} error={undefined}>
          {mockChildren}
        </AuthorizedUI>
      );

      expect(container).toMatchSnapshot();
    });

    it("should display children content when authenticated", () => {
      render(
        <AuthorizedUI loading={false} error={undefined}>
          {mockChildren}
        </AuthorizedUI>
      );

      expect(screen.getByText("Protected Content")).toBeInTheDocument();
    });

    it("should render complex children correctly", () => {
      render(
        <AuthorizedUI loading={false} error={undefined}>
          <div>
            <h1>Dashboard</h1>
            <p>Welcome back!</p>
          </div>
        </AuthorizedUI>
      );

      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getByText("Welcome back!")).toBeInTheDocument();
    });
  });

  describe("Priority of States", () => {
    it("should prioritize loading over error", () => {
      const mockError = new Error("Test error");
      render(
        <AuthorizedUI loading={true} error={mockError}>
          {mockChildren}
        </AuthorizedUI>
      );

      expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    });
  });
});
