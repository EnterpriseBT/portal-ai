/**
 * #1077: the sidebar's Favorites group wired to the four `favorite=true`
 * lists.
 */
import type React from "react";

import { jest } from "@jest/globals";

type Row = { id: string; name?: string; label?: string };

const query = (data: unknown, extra: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isError: false,
  isSuccess: data !== undefined,
  ...extra,
});
const failed = () => query(undefined, { isError: true, isSuccess: false });

let mockStations: Row[] = [];
let mockPins: Row[] = [];
let mockViews: Row[] = [];
let mockConnectors: Row[] = [];
let mockPinsFail = false;
const mockParams: Record<string, unknown> = {};

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    stations: {
      list: (p: unknown) => {
        mockParams.station = p;
        return query({ stations: mockStations });
      },
    },
    portalResults: {
      list: (p: unknown) => {
        mockParams.pin = p;
        return mockPinsFail ? failed() : query({ portalResults: mockPins });
      },
    },
    curatedViews: {
      list: (p: unknown) => {
        mockParams.curated_view = p;
        return query({ curatedViews: mockViews });
      },
    },
    connectorInstances: {
      list: (p: unknown) => {
        mockParams.connector_instance = p;
        return query({ connectorInstances: mockConnectors });
      },
    },
  },
}));

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { SidebarFavorites, SIDEBAR_FAVORITES_OPEN_KEY } =
  await import("../components/SidebarFavorites.component");
const { queryKeys } = await import("../api/keys");
const { favoriteKeys } = await import("../utils/favorite-invalidation.util");

const inNav = (ui: React.ReactElement) => <nav aria-label="Primary">{ui}</nav>;
const linkNames = () =>
  screen.getAllByRole("link").map((l) => l.textContent ?? "");

beforeEach(() => {
  localStorage.clear();
  mockStations = [{ id: "s1", name: "Sales" }];
  mockPins = [{ id: "p1", name: "Ad spend" }];
  mockViews = [{ id: "v1", label: "Orders" }];
  mockConnectors = [{ id: "c1", name: "billing" }];
  mockPinsFail = false;
});

describe("SidebarFavorites (container, #1077)", () => {
  it("merges the four types' favorites by name, linked to their pages", async () => {
    const { container } = render(inNav(<SidebarFavorites collapsed={false} />));
    expect(linkNames()).toEqual(["Ad spend", "billing", "Orders", "Sales"]);
    expect(screen.getByRole("link", { name: "Orders" })).toHaveAttribute(
      "href",
      "/views/v1"
    );
    expect(screen.getByRole("link", { name: "billing" })).toHaveAttribute(
      "href",
      "/connectors/c1"
    );
    await expectNoAxeViolations(container);
  });

  it("reads only favorites, through keys a star refreshes", () => {
    render(inNav(<SidebarFavorites collapsed={false} />));
    const listKey = {
      station: () => queryKeys.stations.list(mockParams.station as never),
      pin: () => queryKeys.portalResults.list(mockParams.pin as never),
      curated_view: () =>
        queryKeys.curatedViews.list(mockParams.curated_view as never),
      connector_instance: () =>
        queryKeys.connectorInstances.list(
          mockParams.connector_instance as never
        ),
    } as const;
    for (const type of Object.keys(listKey) as (keyof typeof listKey)[]) {
      expect(mockParams[type]).toEqual(
        expect.objectContaining({ favorite: "true", limit: 100 })
      );
      // favoriteKeys' first key is the type's list prefix.
      const prefix = favoriteKeys({ type, id: "x" })[0] as readonly unknown[];
      expect(listKey[type]().slice(0, prefix.length)).toEqual([...prefix]);
    }
  });

  it("shows the other types when one list fails", () => {
    mockPinsFail = true;
    render(inNav(<SidebarFavorites collapsed={false} />));
    expect(linkNames()).toEqual(["billing", "Orders", "Sales"]);
  });

  it("marks the favorite for the current page, and pages under it", () => {
    render(inNav(<SidebarFavorites collapsed={false} />), {
      initialEntry: "/stations/s1/settings",
    });
    expect(screen.getByRole("link", { name: "Sales" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Orders" })).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("remembers the group's expanded state per browser", async () => {
    const first = render(inNav(<SidebarFavorites collapsed={false} />));
    const toggle = screen.getByRole("button", { name: "Favorites" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(toggle);
    expect(localStorage.getItem(SIDEBAR_FAVORITES_OPEN_KEY)).toBe("false");
    first.unmount();
    render(inNav(<SidebarFavorites collapsed={false} />));
    expect(screen.getByRole("button", { name: "Favorites" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  it("closes the mobile drawer on a pick", async () => {
    const onNavigate = jest.fn();
    render(
      inNav(<SidebarFavorites collapsed={false} onNavigate={onNavigate} />)
    );
    await userEvent.click(screen.getByRole("link", { name: "Sales" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("teaches how to add favorites when there are none", () => {
    mockStations = [];
    mockPins = [];
    mockViews = [];
    mockConnectors = [];
    render(inNav(<SidebarFavorites collapsed={false} />));
    expect(
      screen.getByText(
        "Star a station, pinned result, view or connector to keep it here."
      )
    ).toBeInTheDocument();
  });
});
