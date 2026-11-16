import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";

import { Button } from "../../ui/Button";
import { GatedButton } from "../../ui/GatedButton";
import type { ActionGate } from "../../ui/ActionGate";
import { expectNoAxeViolations } from "../axe.util";

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

// #793: the reason reaches assistive tech without hovering, as the button's
// description; its name stays the button's own.
/** The text of the elements an aria-describedby names (#793): the reason
 *  must be a permanent description, not the tooltip's `title` fallback. */
const describedByText = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

describe("GatedButton reason (#793)", () => {
  it.each([
    ["disable", { kind: "disable", reason: "A sync is running" }],
    [
      "upsell",
      { kind: "upsell", reason: "On a higher plan", onUpgrade: () => {} },
    ],
  ] as const)("%s is described by its reason without hovering", (_k, gate) => {
    render(<GatedButton gate={gate}>Edit</GatedButton>);
    const button = screen.getByRole("button", { name: /^Edit$/ });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(describedByText(button)).toBe(gate.reason);
  });

  it("allow has no description", () => {
    render(<GatedButton gate={{ kind: "allow" }}>Edit</GatedButton>);
    expect(screen.getByRole("button", { name: "Edit" })).not.toHaveAttribute(
      "aria-describedby"
    );
  });

  it("keeps a caller's own description alongside the reason", () => {
    render(
      <>
        <span id="hint">Edits the name</span>
        <GatedButton
          aria-describedby="hint"
          gate={{ kind: "disable", reason: "A sync is running" }}
        >
          Edit
        </GatedButton>
      </>
    );
    expect(
      screen.getByRole("button", { name: "Edit" })
    ).toHaveAccessibleDescription("Edits the name A sync is running");
  });

  it("disable adds no styles of its own (the theme owns the look)", () => {
    render(
      <>
        <GatedButton gate={{ kind: "disable", reason: "A sync is running" }}>
          Gated
        </GatedButton>
        <Button aria-disabled="true" disableRipple>
          Plain
        </Button>
      </>
    );
    expect(screen.getByRole("button", { name: "Gated" }).className).toBe(
      screen.getByRole("button", { name: "Plain" }).className
    );
  });

  it.each([
    ["allow", { kind: "allow" }],
    ["disable", { kind: "disable", reason: "A sync is running" }],
    [
      "upsell",
      { kind: "upsell", reason: "On a higher plan", onUpgrade: () => {} },
    ],
  ] as const)("%s has no axe violations", async (_k, gate) => {
    const { container } = render(<GatedButton gate={gate}>Edit</GatedButton>);
    await expectNoAxeViolations(container);
  });
});

// #793: a disable gate wins over a caller's native `disabled`, so a dialog's
// submit stays focusable while it saves even when its form is also invalid.
describe("GatedButton with disabled (#793)", () => {
  it("a disable gate ignores native disabled", () => {
    render(
      <GatedButton disabled gate={{ kind: "disable", reason: "Saving…" }}>
        Save
      </GatedButton>
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  it("allow keeps native disabled", () => {
    render(
      <GatedButton disabled gate={{ kind: "allow" }}>
        Save
      </GatedButton>
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

// #793: the point of pendingGate: the focused button survives the switch
// into its disabled state (same element, not a remount), so focus stays.
describe("GatedButton keeps focus across gates (#793)", () => {
  it.each([
    [
      "allow → disable",
      { kind: "allow" },
      { kind: "disable", reason: "Saving…" },
    ],
    [
      "disable → allow",
      { kind: "disable", reason: "Saving…" },
      { kind: "allow" },
    ],
    [
      "allow → upsell",
      { kind: "allow" },
      { kind: "upsell", reason: "Higher plan", onUpgrade: () => {} },
    ],
  ] as const)("%s keeps the same focused element", (_k, from, to) => {
    const { rerender } = render(<GatedButton gate={from}>Save</GatedButton>);
    const button = screen.getByRole("button", { name: "Save" });
    button.focus();
    rerender(<GatedButton gate={to}>Save</GatedButton>);
    expect(screen.getByRole("button", { name: "Save" })).toBe(button);
    expect(button).toHaveFocus();
  });
});
