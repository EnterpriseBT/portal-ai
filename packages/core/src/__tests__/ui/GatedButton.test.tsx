import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";

import { GatedButton } from "../../ui/GatedButton";
import type { ActionGate } from "../../ui/ActionGate";

/**
 * #688: a gated CTA renders the convention, decided elsewhere: hide /
 * disable-with-reason (focusable, announced) / upsell / allow.
 */
describe("GatedButton", () => {
  const renderWith = (gate: ActionGate | undefined, onClick = jest.fn()) => {
    render(
      <GatedButton gate={gate} onClick={onClick}>
        Edit
      </GatedButton>
    );
    return onClick;
  };

  it("allow (and an omitted gate) renders a normal, clickable button", async () => {
    const user = userEvent.setup();
    const onClick = renderWith(undefined);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("hide renders nothing", () => {
    renderWith({ kind: "hide" });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("disable is aria-disabled, not natively disabled, and swallows clicks", async () => {
    const user = userEvent.setup();
    const onClick = renderWith({
      kind: "disable",
      reason: "A sync is running",
    });
    const button = screen.getByRole("button", { name: "Edit" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disable stays in the tab order and shows its reason on focus", async () => {
    const user = userEvent.setup();
    renderWith({ kind: "disable", reason: "A sync is running" });
    await user.tab();
    expect(screen.getByRole("button", { name: "Edit" })).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "A sync is running"
    );
  });

  it("disable shows its reason on hover", async () => {
    const user = userEvent.setup();
    renderWith({ kind: "disable", reason: "A sync is running" });
    await user.hover(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "A sync is running"
    );
  });

  it("upsell is enabled, shows its reason, and calls onUpgrade instead of onClick", async () => {
    const user = userEvent.setup();
    const onUpgrade = jest.fn();
    const onClick = renderWith({
      kind: "upsell",
      reason: "Custom toolpacks are on a higher plan",
      onUpgrade,
    });
    const button = screen.getByRole("button", { name: /Edit/ });
    expect(button).not.toHaveAttribute("aria-disabled");
    await user.hover(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Custom toolpacks are on a higher plan"
    );
    await user.click(button);
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
