import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";

import { GatedIconButton } from "../../ui/GatedIconButton";
import { IconName } from "../../ui/Icon";
import type { ActionGate } from "../../ui/ActionGate";

describe("GatedIconButton", () => {
  const renderWith = (gate: ActionGate | undefined, onClick = jest.fn()) => {
    render(
      <GatedIconButton
        icon={IconName.Delete}
        aria-label="Delete view"
        gate={gate}
        onClick={onClick}
      />
    );
    return onClick;
  };

  it("allow renders a clickable icon button", async () => {
    const user = userEvent.setup();
    const onClick = renderWith({ kind: "allow" });
    await user.click(screen.getByRole("button", { name: "Delete view" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("hide renders nothing", () => {
    renderWith({ kind: "hide" });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("disable is focusable, aria-disabled, swallows clicks, and announces its reason", async () => {
    const user = userEvent.setup();
    const onClick = renderWith({
      kind: "disable",
      reason: "An import is running",
    });
    const button = screen.getByRole("button", { name: "Delete view" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    await user.tab();
    expect(button).toHaveFocus();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "An import is running"
    );
  });

  it("upsell calls onUpgrade", async () => {
    const user = userEvent.setup();
    const onUpgrade = jest.fn();
    renderWith({ kind: "upsell", reason: "On a higher plan", onUpgrade });
    await user.click(screen.getByRole("button", { name: "Delete view" }));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });
});
