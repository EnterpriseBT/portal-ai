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

const { NotFoundView } = await import("../views/NotFound.view");

const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

describe("NotFoundView Component", () => {
  it("should match snapshot", () => {
    const { container } = renderWithTheme(<NotFoundView />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("should display 404 status code", () => {
    renderWithTheme(<NotFoundView />);
    expect(screen.getByText("404")).toBeInTheDocument();
  });

  it("should display the correct title", () => {
    renderWithTheme(<NotFoundView />);
    expect(screen.getByText("Page Not Found")).toBeInTheDocument();
  });

  it("should display the default description", () => {
    renderWithTheme(<NotFoundView />);
    expect(
      screen.getByText(
        "The page you're looking for doesn't exist or has been moved."
      )
    ).toBeInTheDocument();
  });

  it("should allow overriding the description", () => {
    renderWithTheme(<NotFoundView description="Custom not found message." />);
    expect(screen.getByText("Custom not found message.")).toBeInTheDocument();
  });
});
