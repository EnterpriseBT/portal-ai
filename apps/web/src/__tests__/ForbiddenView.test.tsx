import { jest } from "@jest/globals";
import { render, screen } from "./test-utils";
import { ThemeProvider } from "@mcp-ui/core/ui";
import React from "react";

jest.unstable_mockModule("@tanstack/react-router", () => ({
  useRouter: () => ({
    history: { back: jest.fn() },
    navigate: jest.fn(),
  }),
}));

const { ForbiddenView } = await import("../views/Forbidden.view");

const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

describe("ForbiddenView Component", () => {
  it("should match snapshot", () => {
    const { container } = renderWithTheme(<ForbiddenView />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("should display 403 status code", () => {
    renderWithTheme(<ForbiddenView />);
    expect(screen.getByText("403")).toBeInTheDocument();
  });

  it("should display the correct title", () => {
    renderWithTheme(<ForbiddenView />);
    expect(screen.getByText("Forbidden")).toBeInTheDocument();
  });

  it("should display the default description", () => {
    renderWithTheme(<ForbiddenView />);
    expect(
      screen.getByText("You don't have permission to access this resource.")
    ).toBeInTheDocument();
  });

  it("should allow overriding the description", () => {
    renderWithTheme(<ForbiddenView description="Access denied." />);
    expect(screen.getByText("Access denied.")).toBeInTheDocument();
  });
});
