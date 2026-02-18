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
});
