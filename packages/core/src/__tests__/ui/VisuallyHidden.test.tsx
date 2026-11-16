import React from "react";
import { render, screen } from "@testing-library/react";

import { VisuallyHidden } from "../../ui/VisuallyHidden";
import { expectNoAxeViolations } from "../axe.util";

// #794: screen-reader-only text.
describe("VisuallyHidden", () => {
  it("keeps its text in the accessibility tree", () => {
    render(
      <button type="button">
        <VisuallyHidden>Close dialog</VisuallyHidden>
      </button>
    );
    expect(
      screen.getByRole("button", { name: "Close dialog" })
    ).toBeInTheDocument();
  });
});

describe("VisuallyHidden accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <button type="button">
        <VisuallyHidden>Close dialog</VisuallyHidden>
      </button>
    );
    await expectNoAxeViolations(container);
  });
});
