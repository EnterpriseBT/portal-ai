import { jest } from "@jest/globals";
import {
  render as rtlRender,
  screen,
  fireEvent,
} from "@testing-library/react";
import { ThemeProvider } from "@portalai/core/ui";
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterContextProvider,
} from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import React from "react";
import { HttpError } from "../components/HttpError.component";

const mockBack = jest.fn();
const mockNavigate = jest.fn();

const renderWithTheme = (ui: React.ReactElement) => {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    context: { queryClient: new QueryClient() },
  });
  router.history.back = mockBack;
  router.navigate = mockNavigate as typeof router.navigate;

  return rtlRender(
    <ThemeProvider defaultTheme="brand">
      <RouterContextProvider router={router}>{ui}</RouterContextProvider>
    </ThemeProvider>
  );
};

describe("HttpError Component", () => {
  beforeEach(() => {
    mockBack.mockClear();
    mockNavigate.mockClear();
  });

  it("should match snapshot", () => {
    const { container } = renderWithTheme(
      <HttpError statusCode={404} title="Not Found" />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("should display the status code", () => {
    renderWithTheme(<HttpError statusCode={404} title="Not Found" />);
    expect(screen.getByText("404")).toBeInTheDocument();
  });

  it("should display the title", () => {
    renderWithTheme(<HttpError statusCode={500} title="Server Error" />);
    expect(screen.getByText("Server Error")).toBeInTheDocument();
  });

  it("should display description when provided", () => {
    renderWithTheme(
      <HttpError
        statusCode={404}
        title="Not Found"
        description="The page does not exist."
      />
    );
    expect(screen.getByText("The page does not exist.")).toBeInTheDocument();
  });

  it("should not render description when not provided", () => {
    const { container } = renderWithTheme(
      <HttpError statusCode={404} title="Not Found" />
    );
    const bodyTexts = container.querySelectorAll(".MuiTypography-body1");
    expect(bodyTexts.length).toBe(0);
  });

  it("should render correct icon for 404", () => {
    const { container } = renderWithTheme(
      <HttpError statusCode={404} title="Not Found" />
    );
    expect(
      container.querySelector("[data-testid='SearchIcon']")
    ).toBeInTheDocument();
  });

  it("should render correct icon for 401", () => {
    const { container } = renderWithTheme(
      <HttpError statusCode={401} title="Unauthorized" />
    );
    expect(
      container.querySelector("[data-testid='LockIcon']")
    ).toBeInTheDocument();
  });

  it("should render correct icon for 403", () => {
    const { container } = renderWithTheme(
      <HttpError statusCode={403} title="Forbidden" />
    );
    expect(
      container.querySelector("[data-testid='BlockIcon']")
    ).toBeInTheDocument();
  });

  it("should render correct icon for 500", () => {
    const { container } = renderWithTheme(
      <HttpError statusCode={500} title="Server Error" />
    );
    expect(
      container.querySelector("[data-testid='WarningIcon']")
    ).toBeInTheDocument();
  });

  it("should render fallback icon for unknown status codes", () => {
    const { container } = renderWithTheme(
      <HttpError statusCode={418} title="I'm a Teapot" />
    );
    expect(
      container.querySelector("[data-testid='WarningIcon']")
    ).toBeInTheDocument();
  });

  it("should render Go Back and Go Home buttons by default", () => {
    renderWithTheme(<HttpError statusCode={404} title="Not Found" />);
    expect(
      screen.getByRole("button", { name: /go back/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /go home/i })
    ).toBeInTheDocument();
  });

  it("should hide Go Back button when showBackButton is false", () => {
    renderWithTheme(
      <HttpError statusCode={404} title="Not Found" showBackButton={false} />
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
      <HttpError statusCode={404} title="Not Found" showHomeButton={false} />
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
      <HttpError
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
    renderWithTheme(<HttpError statusCode={404} title="Not Found" />);
    fireEvent.click(screen.getByRole("button", { name: /go back/i }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("should call router.navigate to home when Go Home is clicked", () => {
    renderWithTheme(<HttpError statusCode={404} title="Not Found" />);
    fireEvent.click(screen.getByRole("button", { name: /go home/i }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/", reloadDocument: true });
  });
});
