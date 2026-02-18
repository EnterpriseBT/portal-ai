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

const { BadRequestView } = await import("../views/BadRequest.view");

const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

describe("BadRequestView Component", () => {
  it("should match snapshot", () => {
    const { container } = renderWithTheme(<BadRequestView />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("should display 400 status code", () => {
    renderWithTheme(<BadRequestView />);
    expect(screen.getByText("400")).toBeInTheDocument();
  });

  it("should display the correct title", () => {
    renderWithTheme(<BadRequestView />);
    expect(screen.getByText("Bad Request")).toBeInTheDocument();
  });

  it("should display the default description", () => {
    renderWithTheme(<BadRequestView />);
    expect(
      screen.getByText(
        "The server could not understand the request due to invalid syntax."
      )
    ).toBeInTheDocument();
  });

  it("should allow overriding the description", () => {
    renderWithTheme(
      <BadRequestView description="Custom bad request message." />
    );
    expect(screen.getByText("Custom bad request message.")).toBeInTheDocument();
  });
});
