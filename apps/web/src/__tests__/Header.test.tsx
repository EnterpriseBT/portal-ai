import { render, screen } from "@testing-library/react";
import { Header } from "../components/Header.component";
import { Button } from "@mcp-ui/core/ui";

describe("Header Component", () => {
  it("should match snapshot", () => {
    const { container } = render(<Header />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("should render with default title", () => {
    render(<Header />);
    expect(screen.getByText("MCP UI")).toBeInTheDocument();
  });

  it("should render with custom title", () => {
    render(<Header title="Custom App Title" />);
    expect(screen.getByText("Custom App Title")).toBeInTheDocument();
    expect(screen.queryByText("MCP UI")).not.toBeInTheDocument();
  });

  it("should render children when provided", () => {
    render(
      <Header>
        <Button>Logout</Button>
      </Header>
    );
    expect(screen.getByRole("button", { name: /logout/i })).toBeInTheDocument();
  });

  it("should render multiple children", () => {
    render(
      <Header title="Dashboard">
        <Button>Settings</Button>
        <Button>Profile</Button>
      </Header>
    );
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /settings/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /profile/i })
    ).toBeInTheDocument();
  });

  it("should render custom title with children", () => {
    render(
      <Header title="Admin Panel">
        <Button>Action</Button>
      </Header>
    );
    expect(screen.getByText("Admin Panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /action/i })).toBeInTheDocument();
  });
});
