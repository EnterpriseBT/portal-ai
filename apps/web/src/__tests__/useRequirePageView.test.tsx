import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import React from "react";
import { render, renderHook, screen } from "@testing-library/react";

const mockCurrent = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: { organizations: { current: mockCurrent } },
}));
jest.unstable_mockModule("../views/Forbidden.view", () => ({
  ForbiddenView: () =>
    React.createElement("div", { "data-testid": "forbidden" }),
}));

const { useRequirePageView, guardedComponent } =
  await import("../utils/use-require-page-view.util");

const withPages = (pages: Record<string, boolean> | undefined) => ({
  data:
    pages === undefined
      ? undefined
      : {
          roles: ["member"],
          capabilities: {},
          organization: {},
          pagePermissions: pages,
        },
});

const Wrapped = () => React.createElement("div", { "data-testid": "page" });

describe("useRequirePageView / guardedComponent (#630)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("is allowed/known when the caller may view the page", () => {
    mockCurrent.mockReturnValue(withPages({ connectors: true }));
    const { result } = renderHook(() => useRequirePageView("connectors"));
    expect(result.current.allowed).toBe(true);
    expect(result.current.known).toBe(true);
  });

  it("guardedComponent renders the page when allowed", () => {
    mockCurrent.mockReturnValue(withPages({ connectors: true }));
    const Guarded = guardedComponent("connectors", Wrapped);
    render(React.createElement(Guarded));
    expect(screen.queryByTestId("page")).not.toBeNull();
    expect(screen.queryByTestId("forbidden")).toBeNull();
  });

  it("guardedComponent renders ForbiddenView when denied (known)", () => {
    mockCurrent.mockReturnValue(withPages({ connectors: false }));
    const Guarded = guardedComponent("connectors", Wrapped);
    render(React.createElement(Guarded));
    expect(screen.queryByTestId("forbidden")).not.toBeNull();
    expect(screen.queryByTestId("page")).toBeNull();
  });

  it("guardedComponent renders optimistically while the query is loading", () => {
    mockCurrent.mockReturnValue(withPages(undefined));
    const Guarded = guardedComponent("connectors", Wrapped);
    render(React.createElement(Guarded));
    expect(screen.queryByTestId("page")).not.toBeNull();
    expect(screen.queryByTestId("forbidden")).toBeNull();
  });
});
