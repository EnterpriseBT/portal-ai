import { jest } from "@jest/globals";

const mockUsage = jest.fn();
const mockNavigate = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    organizations: { usage: mockUsage },
  },
}));

jest.unstable_mockModule("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

const { renderHook } = await import("@testing-library/react");
const { createElement } = await import("react");
const { SettingsTabSwitchContext } =
  await import("../utils/settings-tab.context");
const { useActionGate } = await import("../utils/use-action-gate.util");
const { SettingsTab } = await import("../utils/routes.util");

const usage = (entitlements: {
  customToolpacks: boolean;
  customRbac: boolean;
}) => ({
  data: {
    tier: {
      tier: "team",
      entitlements: { builtinToolpacks: [], ...entitlements },
    },
  },
});

beforeEach(() => {
  mockUsage.mockReset();
  mockNavigate.mockReset();
});

describe("useActionGate (#688)", () => {
  it("entitled reads the tier's flag", () => {
    mockUsage.mockReturnValue(
      usage({ customToolpacks: true, customRbac: false })
    );
    const { result } = renderHook(() => useActionGate());
    expect(result.current.entitled("customToolpacks")).toBe(true);
    expect(result.current.entitled("customRbac")).toBe(false);
  });

  it("entitled fails closed while usage is unknown", () => {
    mockUsage.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useActionGate());
    expect(result.current.entitled("customToolpacks")).toBe(false);
  });

  it("an upsell's onUpgrade navigates to Settings → Billing", () => {
    mockUsage.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useActionGate());
    const gate = result.current.gate({ allowed: true, entitled: false });
    expect(gate.kind).toBe("upsell");
    if (gate.kind !== "upsell") return;
    gate.onUpgrade();
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/settings",
      search: { tab: SettingsTab.Billing },
    });
  });

  it("#691: inside Settings, an upsell switches to the Billing tab instead of navigating", () => {
    mockUsage.mockReturnValue({ data: undefined });
    const switchTab = jest.fn();
    const wrapper = ({ children }: { children: import("react").ReactNode }) =>
      createElement(
        SettingsTabSwitchContext.Provider,
        { value: switchTab },
        children
      );
    const { result } = renderHook(() => useActionGate(), { wrapper });
    const gate = result.current.gate({ allowed: true, entitled: false });
    if (gate.kind !== "upsell") throw new Error("expected upsell");
    gate.onUpgrade();
    expect(switchTab).toHaveBeenCalledWith(SettingsTab.Billing);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
