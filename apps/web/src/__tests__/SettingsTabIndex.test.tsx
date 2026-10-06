import { jest } from "@jest/globals";

// #656: Settings renders Members/Activity/Access conditionally. Each tab must
// keep its logical index when an earlier one is hidden — otherwise a custom
// author role (member.role.assign only) clicks "Access", MUI reports position 3
// (Members), and the elevated-tab guard resets the view to Profile.
const mockUseCapabilities = jest.fn();
jest.unstable_mockModule("../utils/use-capabilities.util", () => ({
  useCapabilities: mockUseCapabilities,
}));

const { render, screen, fireEvent } = await import("./test-utils");
const { SettingsView } = await import("../views/Settings.view");

const withCapabilities = (actions: string[]) =>
  mockUseCapabilities.mockReturnValue({
    roles: ["member"],
    can: (action: string) => actions.includes(action),
    capabilitiesKnown: true,
  });

const ALL = ["member.invite", "org.audit.read", "member.role.assign"];

describe("Settings › tab index with hidden tabs (#656)", () => {
  afterEach(() => window.history.replaceState(null, "", "/settings"));

  it("an author without member/activity capabilities can open Access by clicking it", () => {
    withCapabilities(["member.role.assign"]);
    render(<SettingsView />);

    expect(
      screen.queryByRole("tab", { name: "Members" })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Access" }));

    expect(screen.getByRole("tab", { name: "Access" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(document.getElementById("tabpanel-5")).toBeVisible();
    expect(document.getElementById("tabpanel-0")).not.toBeVisible();
  });

  it("the ?tab=access deep link selects Access for that author", () => {
    window.history.replaceState(null, "", "/settings?tab=access");
    withCapabilities(["member.role.assign"]);
    render(<SettingsView />);

    expect(screen.getByRole("tab", { name: "Access" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("with every capability, Activity and Access still open their own panels", () => {
    withCapabilities(ALL);
    render(<SettingsView />);

    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(document.getElementById("tabpanel-4")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Access" }));
    expect(screen.getByRole("tab", { name: "Access" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(document.getElementById("tabpanel-5")).toBeVisible();
  });

  it("#691: on a plan without custom RBAC, Access offers a link to plans", () => {
    withCapabilities(["member.role.assign"]);
    render(<SettingsView />);
    fireEvent.click(screen.getByRole("tab", { name: "Access" }));
    expect(
      screen.getByText(/Custom roles, policies, and groups are an enterprise/)
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View plans" })).toHaveAttribute(
      "href",
      expect.stringContaining("/settings")
    );
  });

  it("#691: clicking that link inside Settings opens the Billing tab", () => {
    withCapabilities(["member.role.assign"]);
    render(<SettingsView />);
    fireEvent.click(screen.getByRole("tab", { name: "Access" }));
    fireEvent.click(screen.getByRole("link", { name: "View plans" }));
    expect(
      screen.getByRole("tab", { name: "Subscription & Billing" })
    ).toHaveAttribute("aria-selected", "true");
  });
});
