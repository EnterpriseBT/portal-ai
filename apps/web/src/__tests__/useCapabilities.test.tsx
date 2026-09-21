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
});
