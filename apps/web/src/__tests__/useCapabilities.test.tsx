import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockCurrent = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: { organizations: { current: mockCurrent } },
}));

const { useCapabilities } = await import("../utils/use-capabilities.util");

const CAPS = {
  "billing.manage": true,
  "org.delete": false,
  "org.audit.read": true,
  "member.role.assign": false,
  "member.invite": true,
  "member.remove": false,
};

// useCapabilities is pure given the (mocked) query result — no real hooks
// execute, so it can be invoked directly.
describe("useCapabilities (#620)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("exposes roles + a can() that reads the server capability map", () => {
    mockCurrent.mockReturnValue({
      data: { roles: ["admin"], capabilities: CAPS, organization: {} },
    });
    const { roles, can, capabilitiesKnown } = useCapabilities();
    expect(roles).toEqual(["admin"]);
    expect(capabilitiesKnown).toBe(true);
    expect(can("billing.manage")).toBe(true);
    expect(can("org.audit.read")).toBe(true);
    expect(can("member.role.assign")).toBe(false);
  });

  it("reports multiple roles", () => {
    mockCurrent.mockReturnValue({
      data: {
        roles: ["owner", "member"],
        capabilities: CAPS,
        organization: {},
      },
    });
    expect(useCapabilities().roles).toEqual(["owner", "member"]);
  });

  it("loading (no data) → empty roles, can() false, capabilitiesKnown false", () => {
    mockCurrent.mockReturnValue({ data: undefined });
    const { roles, can, capabilitiesKnown } = useCapabilities();
    expect(roles).toEqual([]);
    expect(capabilitiesKnown).toBe(false);
    expect(can("billing.manage")).toBe(false);
  });

  it("can() fails closed for an action absent from the map", () => {
    mockCurrent.mockReturnValue({
      data: { roles: ["member"], capabilities: {}, organization: {} },
    });
    expect(useCapabilities().can("org.delete")).toBe(false);
  });

  // #630 — page-view + resource maps
  it("canViewPage() reads the pagePermissions map, fail-closed", () => {
    mockCurrent.mockReturnValue({
      data: {
        roles: ["member"],
        capabilities: CAPS,
        organization: {},
        pagePermissions: {
          stations: true,
          jobs: true,
          connectors: false,
        },
      },
    });
    const { canViewPage } = useCapabilities();
    expect(canViewPage("stations")).toBe(true);
    expect(canViewPage("connectors")).toBe(false);
    // absent key → fail-closed
    expect(canViewPage("toolpacks")).toBe(false);
  });

  it("canViewPage() fails closed when the map is absent (pre-#630 payload)", () => {
    mockCurrent.mockReturnValue({
      data: { roles: ["member"], capabilities: CAPS, organization: {} },
    });
    expect(useCapabilities().canViewPage("stations")).toBe(false);
  });

  it("canOnResource() reads the resourcePermissions map, fail-closed", () => {
    mockCurrent.mockReturnValue({
      data: {
        roles: ["member"],
        capabilities: CAPS,
        organization: {},
        resourcePermissions: {
          connector_instance: { read: true, write: true, delete: true },
          toolpack: { read: false, write: false, delete: false },
        },
      },
    });
    const { canOnResource } = useCapabilities();
    expect(canOnResource("connector_instance", "delete")).toBe(true);
    expect(canOnResource("toolpack", "read")).toBe(false);
    // absent type → fail-closed
    expect(canOnResource("tag", "read")).toBe(false);
  });
});
