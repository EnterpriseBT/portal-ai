import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";

import { GatedIconButton } from "../../ui/GatedIconButton";
import { IconButton } from "../../ui/IconButton";
import { IconName } from "../../ui/Icon";
import type { ActionGate } from "../../ui/ActionGate";
import { expectNoAxeViolations } from "../axe.util";

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

/** The text of the elements an aria-describedby names (#793): the reason
 *  must be a permanent description, not the tooltip's `title` fallback. */
const describedByText = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

describe("GatedIconButton reason (#793)", () => {
  const gates = [
    ["disable", { kind: "disable", reason: "A sync is running" }],
    [
      "upsell",
      { kind: "upsell", reason: "On a higher plan", onUpgrade: () => {} },
    ],
  ] as const;

  it.each(gates)(
    "%s is described by its reason without hovering",
    (_k, gate) => {
      render(
        <GatedIconButton
          icon={IconName.Delete}
          aria-label="Delete view"
          gate={gate}
        />
      );
      expect(
        describedByText(screen.getByRole("button", { name: "Delete view" }))
      ).toBe(gate.reason);
    }
  );

  it("disable adds no styles of its own (the theme owns the look)", () => {
    render(
      <>
        <GatedIconButton
          icon={IconName.Delete}
          aria-label="Gated"
          gate={{ kind: "disable", reason: "A sync is running" }}
        />
        <IconButton
          icon={IconName.Delete}
          aria-label="Plain"
          aria-disabled="true"
          disableRipple
        />
      </>
    );
    expect(screen.getByRole("button", { name: "Gated" }).className).toBe(
      screen.getByRole("button", { name: "Plain" }).className
    );
  });

  it.each(gates)("%s has no axe violations", async (_k, gate) => {
    const { container } = render(
      <GatedIconButton
        icon={IconName.Delete}
        aria-label="Delete view"
        gate={gate}
      />
    );
    await expectNoAxeViolations(container);
  });
});

describe("GatedIconButton with disabled (#793)", () => {
  it("a disable gate ignores native disabled", () => {
    render(
      <GatedIconButton
        icon={IconName.Delete}
        aria-label="Delete"
        disabled
        gate={{ kind: "disable", reason: "Saving…" }}
      />
    );
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
  });
});

describe("GatedIconButton keeps focus across gates (#793)", () => {
  it("allow → disable keeps the same focused element", () => {
    const { rerender } = render(
      <GatedIconButton
        icon={IconName.Delete}
        aria-label="Delete"
        gate={{ kind: "allow" }}
      />
    );
    const button = screen.getByRole("button", { name: "Delete" });
    button.focus();
    rerender(
      <GatedIconButton
        icon={IconName.Delete}
        aria-label="Delete"
        gate={{ kind: "disable", reason: "Saving…" }}
      />
    );
    expect(screen.getByRole("button", { name: "Delete" })).toBe(button);
    expect(button).toHaveFocus();
  });
});
