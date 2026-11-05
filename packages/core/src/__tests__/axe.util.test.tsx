import { render } from "@testing-library/react";

import { expectNoAxeViolations, JSDOM_DISABLED_AXE_RULES } from "./axe.util";

describe("expectNoAxeViolations", () => {
  it("passes an accessible fragment", async () => {
    const { container } = render(
      <button type="button" aria-label="Close">
        ×
      </button>
    );
    await expectNoAxeViolations(container);
  });

  it("fails a fragment with a violation, naming the rule", async () => {
    const { container } = render(<img src="x.png" />);
    await expect(expectNoAxeViolations(container)).rejects.toThrow(/image-alt/);
  });

  it("ignores colour contrast and landmarks, which jsdom can't measure", async () => {
    expect(JSDOM_DISABLED_AXE_RULES).toEqual(["color-contrast", "region"]);
    const { container } = render(
      <p style={{ color: "#777", backgroundColor: "#888" }}>
        low contrast, outside any landmark
      </p>
    );
    await expectNoAxeViolations(container);
  });

  it("honours extra disabled rules", async () => {
    const { container } = render(<img src="x.png" />);
    await expectNoAxeViolations(container, { disableRules: ["image-alt"] });
  });
});
