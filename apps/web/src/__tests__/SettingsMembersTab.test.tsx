import { jest } from "@jest/globals";

// Mock the role source so we can drive tab gating; the rest of the view's sdk
// calls resolve to loading/undefined under the test QueryClient, which the view
// tolerates (see SettingsView.test).
const mockUseCapabilities = jest.fn();
jest.unstable_mockModule("../utils/use-capabilities.util", () => ({
  useCapabilities: mockUseCapabilities,
}));

const { render, screen } = await import("./test-utils");
const { SettingsView } = await import("../views/Settings.view");

// Elevated = the caller can manage members + view activity (owner/admin).
const asRole = (elevated: boolean) =>
  mockUseCapabilities.mockReturnValue({
    roles: elevated ? ["owner"] : ["member"],
    can: (action: string) =>
      elevated &&
      ["member.invite", "org.audit.read", "member.role.assign"].includes(
        action
      ),
    capabilitiesKnown: true,
  });

describe("Settings › Members tab gating (#585)", () => {
  afterEach(() => window.history.replaceState(null, "", "/settings"));

  it("shows the Members tab for an owner/admin", () => {
    asRole(true);
    render(<SettingsView />);
    expect(screen.getByRole("tab", { name: "Members" })).toBeInTheDocument();
  });

  it("hides the Members tab for a member", () => {
    asRole(false);
    render(<SettingsView />);
    expect(
      screen.queryByRole("tab", { name: "Members" })
    ).not.toBeInTheDocument();
  });
});
