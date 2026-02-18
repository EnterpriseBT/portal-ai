import { render, screen } from "./test-utils";
import { AuthorizedUI } from "../components/Authorized.component";

describe("AuthorizedUI Component", () => {
  const mockChildren = <div>Protected Content</div>;

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
    it("should render ErrorView when error is present", () => {
      const mockError = new Error("Authentication failed");
      const { container } = render(
        <AuthorizedUI loading={false} error={mockError}>
          {mockChildren}
        </AuthorizedUI>
      );

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

    it("should display error description in ErrorView", () => {
      const mockError = new Error("Custom error message");
      render(
        <AuthorizedUI loading={false} error={mockError}>
          {mockChildren}
        </AuthorizedUI>
      );

      expect(
        screen.getByText("Unable to process your request")
      ).toBeInTheDocument();
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
