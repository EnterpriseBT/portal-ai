import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import React from "react";
import { render, screen } from "@testing-library/react";

const mockCurrent = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: { organizations: { current: mockCurrent } },
}));
jest.unstable_mockModule("@portalai/core/ui", () => ({
  AsyncSearchableSelect: () =>
    React.createElement("div", { "data-testid": "select" }),
}));
jest.unstable_mockModule("../components/UnauthorizedState.component", () => ({
  UnauthorizedState: () =>
    React.createElement("div", { "data-testid": "unauthorized" }),
}));

const { GatedAsyncSearchableSelect } =
  await import("../components/GatedAsyncSearchableSelect.component");

const withResources = (
  perms: Record<string, { read: boolean }> | undefined
) => ({
  data:
    perms === undefined
      ? undefined
      : {
          roles: ["member"],
          capabilities: {},
          organization: {},
          resourcePermissions: perms,
        },
});

const base = {
  label: "Pick",
  value: null,
  onChange: () => {},
  onSearch: async () => [],
};

describe("GatedAsyncSearchableSelect (#630)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the select when the caller may read the type", () => {
    mockCurrent.mockReturnValue(
      withResources({ connector_instance: { read: true } })
    );
    render(
      React.createElement(GatedAsyncSearchableSelect, {
        ...base,
        resourceType: "connector_instance",
      } as never)
    );
    expect(screen.queryByTestId("select")).not.toBeNull();
    expect(screen.queryByTestId("unauthorized")).toBeNull();
  });

  it("renders the unauthorized message when the read is denied", () => {
    mockCurrent.mockReturnValue(
      withResources({ connector_instance: { read: false } })
    );
    render(
      React.createElement(GatedAsyncSearchableSelect, {
        ...base,
        resourceType: "connector_instance",
      } as never)
    );
    expect(screen.queryByTestId("unauthorized")).not.toBeNull();
    expect(screen.queryByTestId("select")).toBeNull();
  });

  it("renders the select optimistically while the query is loading", () => {
    mockCurrent.mockReturnValue(withResources(undefined));
    render(
      React.createElement(GatedAsyncSearchableSelect, {
        ...base,
        resourceType: "connector_instance",
      } as never)
    );
    expect(screen.queryByTestId("select")).not.toBeNull();
  });
});
