import React from "react";
import { render, screen } from "@testing-library/react";

import { HiddenPageHeading } from "../../ui/HiddenPageHeading";
import { expectNoAxeViolations } from "../axe.util";

// #982: a page's h1 before its visible header renders (#797).
describe("HiddenPageHeading", () => {
  it("is an h1 named by its text, for screen readers and the tab title", () => {
    render(<HiddenPageHeading>Entity group</HiddenPageHeading>);
    expect(
      screen.getByRole("heading", { level: 1, name: "Entity group" })
    ).toBeInTheDocument();
  });

  it("stays in the accessibility tree but out of sight", () => {
    render(<HiddenPageHeading>Entity group</HiddenPageHeading>);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).not.toHaveAttribute("hidden");
    expect(h1).not.toHaveAttribute("aria-hidden");
    expect(window.getComputedStyle(h1).position).toBe("absolute");
    expect(window.getComputedStyle(h1).width).toBe("1px");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <main>
        <HiddenPageHeading>Entity group</HiddenPageHeading>
      </main>
    );
    await expectNoAxeViolations(container);
  });
});
