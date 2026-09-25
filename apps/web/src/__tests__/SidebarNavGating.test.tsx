import { jest, describe, it, expect } from "@jest/globals";
import type { NavPageId } from "@portalai/core/models";

// visibleNavItems is pure, but the module imports sdk — stub it so the import
// resolves without a provider.
jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    organizations: { current: jest.fn() },
    auth: { logout: jest.fn() },
  },
}));

const { visibleNavItems, NAV_ITEMS } =
  await import("../components/SidebarNav.component");

const labels = (fn: (id: NavPageId) => boolean) =>
  visibleNavItems(fn).map((i) => i.label);

describe("visibleNavItems (#630 sidebar gating)", () => {
  it("a member (stations/pinned/jobs) sees Dashboard + their pages only", () => {
    const memberPages = new Set<NavPageId>(["stations", "pinned", "jobs"]);
    const names = labels((id) => memberPages.has(id));
    // NAV_PAGE_IDS order: stations, pinned, jobs.
    expect(names).toEqual(["Dashboard", "Stations", "Pinned Results", "Jobs"]);
    expect(names).not.toContain("Connectors");
    expect(names).not.toContain("Toolpacks");
  });

  it("an owner/admin (all pages) sees every item", () => {
    const names = labels(() => true);
    expect(names).toHaveLength(NAV_ITEMS.length);
    expect(names).toContain("Connectors");
    expect(names).toContain("Toolpacks");
  });

  it("a role granted only `connectors` sees Dashboard + Connectors", () => {
    const names = labels((id) => id === "connectors");
    expect(names).toEqual(["Dashboard", "Connectors"]);
  });

  it("Dashboard is always shown, even with no page grants (fail-closed elsewhere)", () => {
    expect(labels(() => false)).toEqual(["Dashboard"]);
  });
});
