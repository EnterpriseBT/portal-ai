import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@mcp-ui/core";
import React from "react";

// Mock @tanstack/react-router
const mockBack = jest.fn();
const mockNavigate = jest.fn();

jest.unstable_mockModule("@tanstack/react-router", () => ({
  useRouter: () => ({
    history: { back: mockBack },
    navigate: mockNavigate,
  }),
}));

const { HttpErrorView } = await import("../views/HttpError.view");

const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

describe("HttpErrorView Component", () => {
  beforeEach(() => {
    mockBack.mockClear();
    mockNavigate.mockClear();
  });

  it("should match snapshot", () => {
    const { container } = renderWithTheme(
      <HttpErrorView statusCode={404} title="Not Found" />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("should display the status code", () => {
    renderWithTheme(<HttpErrorView statusCode={404} title="Not Found" />);
    expect(screen.getByText("404")).toBeInTheDocument();
  });

  it("should display the title", () => {
    renderWithTheme(<HttpErrorView statusCode={500} title="Server Error" />);
    expect(screen.getByText("Server Error")).toBeInTheDocument();
  });

  it("should display description when provided", () => {
    renderWithTheme(
      <HttpErrorView
        statusCode={404}
        title="Not Found"
        description="The page does not exist."
      />
    );
    expect(screen.getByText("The page does not exist.")).toBeInTheDocument();
  });

  it("should not render description when not provided", () => {
    const { container } = renderWithTheme(
      <HttpErrorView statusCode={404} title="Not Found" />
    );
    const bodyTexts = container.querySelectorAll(".MuiTypography-body1");
    expect(bodyTexts.length).toBe(0);
  });

  it("should render correct icon for 404", () => {
    renderWithTheme(<HttpErrorView statusCode={404} title="Not Found" />);
    expect(screen.getByText("🔍")).toBeInTheDocument();
  });

  it("should render correct icon for 401", () => {
    renderWithTheme(<HttpErrorView statusCode={401} title="Unauthorized" />);
    expect(screen.getByText("🔒")).toBeInTheDocument();
  });

  it("should render correct icon for 403", () => {
    renderWithTheme(<HttpErrorView statusCode={403} title="Forbidden" />);
    expect(screen.getByText("🚫")).toBeInTheDocument();
  });

  it("should render correct icon for 500", () => {
    renderWithTheme(<HttpErrorView statusCode={500} title="Server Error" />);
    expect(screen.getByText("⚠️")).toBeInTheDocument();
  });

  it("should render fallback icon for unknown status codes", () => {
    renderWithTheme(<HttpErrorView statusCode={418} title="I'm a Teapot" />);
    expect(screen.getByText("⚠️")).toBeInTheDocument();
  });

  it("should render Go Back and Go Home buttons by default", () => {
    renderWithTheme(<HttpErrorView statusCode={404} title="Not Found" />);
    expect(
      screen.getByRole("button", { name: /go back/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /go home/i })
    ).toBeInTheDocument();
  });

  it("should hide Go Back button when showBackButton is false", () => {
    renderWithTheme(
      <HttpErrorView
        statusCode={404}
        title="Not Found"
        showBackButton={false}
      />
    );
    expect(
      screen.queryByRole("button", { name: /go back/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /go home/i })
    ).toBeInTheDocument();
  });

  it("should hide Go Home button when showHomeButton is false", () => {
    renderWithTheme(
      <HttpErrorView
        statusCode={404}
        title="Not Found"
        showHomeButton={false}
      />
    );
    expect(
      screen.getByRole("button", { name: /go back/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /go home/i })
    ).not.toBeInTheDocument();
  });

  it("should hide both buttons when both are false", () => {
    renderWithTheme(
      <HttpErrorView
        statusCode={404}
        title="Not Found"
        showBackButton={false}
        showHomeButton={false}
      />
    );
    expect(
      screen.queryByRole("button", { name: /go back/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /go home/i })
    ).not.toBeInTheDocument();
  });

  it("should call router.history.back when Go Back is clicked", () => {
    renderWithTheme(<HttpErrorView statusCode={404} title="Not Found" />);
    fireEvent.click(screen.getByRole("button", { name: /go back/i }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("should call router.navigate to home when Go Home is clicked", () => {
    renderWithTheme(<HttpErrorView statusCode={404} title="Not Found" />);
    fireEvent.click(screen.getByRole("button", { name: /go home/i }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
  });
});
