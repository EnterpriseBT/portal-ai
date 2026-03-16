import { jest } from "@jest/globals";
import { render, screen } from "./test-utils";
import { ThemeProvider } from "@portalai/core/ui";
import React from "react";

jest.mock("@tanstack/react-router", () => ({
  ...(jest.requireActual("@tanstack/react-router") as object),
  useRouter: () => ({
    history: { back: jest.fn() },
    navigate: jest.fn(),
  }),
}));

import { UnauthorizedView } from "../views/Unauthorized.view";

const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

describe("UnauthorizedView Component", () => {
  it("should match snapshot", () => {
    const { container } = renderWithTheme(<UnauthorizedView />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("should display 401 status code", () => {
    renderWithTheme(<UnauthorizedView />);
    expect(screen.getByText("401")).toBeInTheDocument();
  });

  it("should display the correct title", () => {
    renderWithTheme(<UnauthorizedView />);
    expect(screen.getByText("Unauthorized")).toBeInTheDocument();
  });

  it("should display the default description", () => {
    renderWithTheme(<UnauthorizedView />);
    expect(
      screen.getByText("You need to sign in to access this page.")
    ).toBeInTheDocument();
  });

  it("should allow overriding the description", () => {
    renderWithTheme(<UnauthorizedView description="Please log in first." />);
    expect(screen.getByText("Please log in first.")).toBeInTheDocument();
  });
});
