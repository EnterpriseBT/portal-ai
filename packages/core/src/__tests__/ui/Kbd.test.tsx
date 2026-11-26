import React from "react";
import { render, screen } from "@testing-library/react";

import { Kbd } from "../../ui/Kbd";
import { expectNoAxeViolations } from "../axe.util";

describe("Kbd (#1122)", () => {
  it("draws a key as a kbd element", async () => {
    const { container } = render(
      <p>
        Press <Kbd>⌘K</Kbd> to search
      </p>
    );
    const key = screen.getByText("⌘K");
    expect(key.tagName).toBe("KBD");
    await expectNoAxeViolations(container);
  });

  it("can be hidden from assistive tech", () => {
    render(<Kbd aria-hidden>Ctrl K</Kbd>);
    expect(screen.getByText("Ctrl K")).toHaveAttribute("aria-hidden", "true");
  });
});
