/**
 * #708: a page's Create decides from `resourcePermissions[type].create` (the
 * create route's own check), never the any-grant `write`. A caller who reads
 * the type but can't create one sees Create disabled with the grant hint; a
 * caller who can't read it doesn't see it.
 */
import { jest } from "@jest/globals";

const mockCurrent = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    organizations: {
      current: mockCurrent,
      usage: () => ({ data: undefined }),
    },
  },
}));
jest.unstable_mockModule("@tanstack/react-router", () => ({
  useNavigate: () => jest.fn(),
}));

const { renderHook } = await import("@testing-library/react");
const { useCreateGate } = await import("../utils/use-create-gate.util");

const HINT = "Ask for access to create views";
const current = (curatedView: Record<string, boolean>) => ({
  data: {
    roles: ["member"],
    capabilities: {},
    organization: {},
    resourcePermissions: { curated_view: curatedView },
  },
});
const gateFor = () =>
  renderHook(() => useCreateGate("curated_view", HINT)).result.current;

beforeEach(() => mockCurrent.mockReset());

describe("useCreateGate (#708)", () => {
  it("allows Create when the caller may create one", () => {
    mockCurrent.mockReturnValue(
      current({ read: true, write: true, delete: true, create: true })
    );
    expect(gateFor()).toEqual({ kind: "allow" });
  });

  // Spec case 17: the seeded member on Views.
  it("disables Create with the hint when write is true but create is false", () => {
    mockCurrent.mockReturnValue(
      current({ read: true, write: true, delete: true, create: false })
    );
    expect(gateFor()).toEqual({ kind: "disable", reason: HINT });
  });

  it("hides Create from a caller who can't read the type", () => {
    mockCurrent.mockReturnValue(
      current({ read: false, write: false, delete: false, create: false })
    );
    expect(gateFor()).toEqual({ kind: "hide" });
  });

  it("fails closed while the permissions are unknown", () => {
    mockCurrent.mockReturnValue({ data: undefined });
    expect(gateFor()).toEqual({ kind: "hide" });
  });
});
