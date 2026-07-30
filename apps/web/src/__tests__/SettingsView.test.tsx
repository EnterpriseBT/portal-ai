import { render, screen } from "./test-utils";
import { SettingsView } from "../views/Settings.view";

describe("SettingsView Component", () => {
  it("should match snapshot", () => {
    const { container } = render(<SettingsView />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("should display the Settings heading", () => {
    render(<SettingsView />);
    expect(
      screen.getByRole("heading", { name: "Settings" })
    ).toBeInTheDocument();
  });

  // ── ?tab= deep link (#284) ─────────────────────────────────────────
  //
  // Unentitled-toolpack affordances link to /settings?tab=billing. A link
  // that names a plan limit and then lands on the General tab is not an
  // upgrade path. Seeded at mount only — clicking tabs does not rewrite
  // the param.

  describe("?tab= seeding", () => {
    const at = (search: string) =>
      window.history.replaceState(null, "", `/settings${search}`);

    afterEach(() => at(""));

    it("opens Subscription & Billing when ?tab=billing is present", () => {
      at("?tab=billing");
      render(<SettingsView />);
      expect(
        screen.getByRole("tab", { name: "Subscription & Billing" })
      ).toHaveAttribute("aria-selected", "true");
    });

    it("opens the first tab when no tab param is present", () => {
      at("");
      render(<SettingsView />);
      expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute(
        "aria-selected",
        "true"
      );
    });

    it("opens the first tab for an unrecognized tab value", () => {
      at("?tab=not-a-tab");
      render(<SettingsView />);
      expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute(
        "aria-selected",
        "true"
      );
    });
  });
});
