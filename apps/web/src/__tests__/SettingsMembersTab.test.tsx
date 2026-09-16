import { jest } from "@jest/globals";

// Mock the role source so we can drive tab gating; the rest of the view's sdk
// calls resolve to loading/undefined under the test QueryClient, which the view
// tolerates (see SettingsView.test).
const mockUseRole = jest.fn();
jest.unstable_mockModule("../utils/use-role.util", () => ({
  useRole: mockUseRole,
}));

const { render, screen } = await import("./test-utils");
const { SettingsView } = await import("../views/Settings.view");

const asRole = (isAdminOrOwner: boolean) =>
  mockUseRole.mockReturnValue({
    role: isAdminOrOwner ? "owner" : "member",
    isOwner: isAdminOrOwner,
    isAdmin: false,
    isAdminOrOwner,
    roleKnown: true,
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
