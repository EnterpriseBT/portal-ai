import { jest } from "@jest/globals";

const mockUsage = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    organizations: { usage: mockUsage },
  },
}));

const { render, screen } = await import("./test-utils");
const { useCustomRbacEntitled } =
  await import("../utils/use-custom-rbac-entitled.util");

const loaded = <T,>(data: T) => ({
  data,
  error: null,
  isLoading: false,
  isError: false,
  isSuccess: true,
});
const loading = () => ({
  data: undefined,
  error: null,
  isLoading: true,
  isError: false,
  isSuccess: false,
});

const usagePayload = (customRbac: boolean) => ({
  tier: {
    tier: "enterprise",
    entitlements: { builtinToolpacks: [], customToolpacks: false, customRbac },
  },
  usage: { periodId: "2026-07", byClass: {} },
});

const Probe = () => (
  <span data-testid="entitled">{String(useCustomRbacEntitled())}</span>
);

beforeEach(() => mockUsage.mockReset());

describe("useCustomRbacEntitled (#622)", () => {
  it("reflects the tier's customRbac flag when resolved", () => {
    mockUsage.mockReturnValue(loaded(usagePayload(true)));
    render(<Probe />);
    expect(screen.getByTestId("entitled").textContent).toBe("true");
  });

  it("is false when the tier lacks the entitlement", () => {
    mockUsage.mockReturnValue(loaded(usagePayload(false)));
    render(<Probe />);
    expect(screen.getByTestId("entitled").textContent).toBe("false");
  });

  it("fails closed while loading (gates authoring, so unknown → locked)", () => {
    mockUsage.mockReturnValue(loading());
    render(<Probe />);
    expect(screen.getByTestId("entitled").textContent).toBe("false");
  });
});
