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

const { ServerErrorView } = await import("../views/ServerError.view");

const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

describe("ServerErrorView Component", () => {
  it("should match snapshot", () => {
    const { container } = renderWithTheme(<ServerErrorView />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("should display 500 status code", () => {
    renderWithTheme(<ServerErrorView />);
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("should display the correct title", () => {
    renderWithTheme(<ServerErrorView />);
    expect(screen.getByText("Internal Server Error")).toBeInTheDocument();
  });

  it("should display the default description", () => {
    renderWithTheme(<ServerErrorView />);
    expect(
      screen.getByText(
        "Something went wrong on our end. Please try again later."
      )
    ).toBeInTheDocument();
  });

  it("should allow overriding the description", () => {
    renderWithTheme(<ServerErrorView description="Unexpected failure." />);
    expect(screen.getByText("Unexpected failure.")).toBeInTheDocument();
  });
});
