import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { jest } from "@jest/globals";

import { WidgetFreshnessBar } from "../../ui/WidgetFreshnessBar";

/**
 * Shared widget chrome (#349): the "Updated X ago" cue, the manual refresh
 * button, and the degraded state, extracted so map / d3 / table / pin all
 * report freshness identically instead of hand-rolling it four times.
 */
describe("WidgetFreshnessBar", () => {
  const NOW = Date.now();

  it("renders the freshness cue when lastUpdatedAt is set", () => {
    render(
      <WidgetFreshnessBar
        lastUpdatedAt={NOW - 60_000}
        refreshLabel="Refresh table"
      />
    );
    expect(screen.getByTestId("widget-freshness-updated")).toHaveTextContent(
      /^Updated /
    );
  });

  it("renders no cue when lastUpdatedAt is null", () => {
    render(
      <WidgetFreshnessBar lastUpdatedAt={null} refreshLabel="Refresh table" />
    );
    expect(screen.queryByTestId("widget-freshness-updated")).toBeNull();
  });

  it("renders the refresh button with refreshLabel as its aria-label and fires onRefresh", () => {
    const onRefresh = jest.fn();
    render(
      <WidgetFreshnessBar
        lastUpdatedAt={NOW}
        canRefresh
        onRefresh={onRefresh}
        refreshLabel="Refresh chart"
      />
    );
    const button = screen.getByRole("button", { name: "Refresh chart" });
    fireEvent.click(button);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows a spinner and disables the button while refreshing", () => {
    render(
      <WidgetFreshnessBar
        lastUpdatedAt={NOW}
        canRefresh
        isRefreshing
        onRefresh={jest.fn()}
        refreshLabel="Refresh map"
      />
    );
    expect(screen.getByRole("button", { name: "Refresh map" })).toBeDisabled();
    expect(
      screen.getByTestId("widget-freshness-refreshing")
    ).toBeInTheDocument();
  });

  /**
   * Discovery Q2: a pre-pipeline block isn't a failure, it's a historical
   * block. It shows when its data was produced and simply offers no refresh —
   * NOT a degraded chip, which would read as "something went wrong".
   */
  it("renders the cue but no refresh button when notRefreshable", () => {
    render(
      <WidgetFreshnessBar
        lastUpdatedAt={NOW}
        canRefresh
        notRefreshable
        onRefresh={jest.fn()}
        refreshLabel="Refresh table"
      />
    );
    expect(screen.getByTestId("widget-freshness-updated")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh table" })).toBeNull();
    expect(screen.queryByTestId("widget-freshness-degraded")).toBeNull();
  });

  it("renders the degraded chip, taking precedence over the plain cue", () => {
    render(
      <WidgetFreshnessBar
        lastUpdatedAt={NOW - 120_000}
        canRefresh
        degraded
        onRefresh={jest.fn()}
        refreshLabel="Refresh table"
      />
    );
    const degraded = screen.getByTestId("widget-freshness-degraded");
    expect(degraded).toHaveTextContent(/Couldn't update/);
    expect(degraded).toHaveTextContent(/showing data from/);
    // The plain cue is replaced, not rendered alongside.
    expect(screen.queryByTestId("widget-freshness-updated")).toBeNull();
    // The user can still retry.
    expect(
      screen.getByRole("button", { name: "Refresh table" })
    ).toBeInTheDocument();
  });

  it("renders a status chip when status is not ready", () => {
    render(
      <WidgetFreshnessBar
        lastUpdatedAt={NOW}
        status="stale"
        refreshLabel="Refresh chart"
      />
    );
    expect(screen.getByTestId("widget-freshness-status")).toHaveTextContent(
      "Stale"
    );
  });

  it("renders no status chip when status is ready", () => {
    render(
      <WidgetFreshnessBar
        lastUpdatedAt={NOW}
        status="ready"
        refreshLabel="Refresh chart"
      />
    );
    expect(screen.queryByTestId("widget-freshness-status")).toBeNull();
  });

  it("renders the title when given", () => {
    render(
      <WidgetFreshnessBar
        title="Largest parcels"
        lastUpdatedAt={NOW}
        refreshLabel="Refresh table"
      />
    );
    expect(screen.getByText("Largest parcels")).toBeInTheDocument();
  });

  it("renders nothing at all when there is no title, cue, chip, or affordance", () => {
    const { container } = render(
      <WidgetFreshnessBar lastUpdatedAt={null} refreshLabel="Refresh table" />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
