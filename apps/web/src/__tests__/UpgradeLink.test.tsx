import { render, screen } from "./test-utils";
import { UpgradeLink } from "../components/UpgradeLink.component";
import { UPGRADE_CTA_LABEL } from "../utils/tool-packs.util";

describe("UpgradeLink (#284)", () => {
  it("renders the shared CTA label and targets the billing tab", () => {
    render(<UpgradeLink />);

    const link = screen.getByRole("link", { name: UPGRADE_CTA_LABEL });
    // One shared destination so every unentitled affordance agrees.
    expect(link).toHaveAttribute("href", "/settings?tab=billing");
  });
});
