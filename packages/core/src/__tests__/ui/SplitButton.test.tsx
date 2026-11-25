import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";

import { SplitButton } from "../../ui/SplitButton";
import { expectNoAxeViolations } from "../axe.util";

const menuItems = () => [
  { label: "On this page", onClick: jest.fn() },
  {
    label: "Sales Ops",
    onClick: jest.fn(),
    gate: { kind: "disable" as const, reason: "You can't start portals here" },
  },
  { label: "Hidden", onClick: jest.fn(), gate: { kind: "hide" as const } },
];

describe("SplitButton (#1122)", () => {
  it("runs the main action", async () => {
    const onClick = jest.fn();
    render(
      <SplitButton
        label="New portal"
        onClick={onClick}
        menuItems={menuItems()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "New portal" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("opens its menu from a menu button, with gated items, and closes on Escape", async () => {
    const items = menuItems();
    const { baseElement } = render(
      <SplitButton label="New portal" onClick={jest.fn()} menuItems={items} />
    );
    const trigger = screen.getByRole("button", {
      name: "More options for New portal",
    });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(trigger);
    const menu = await screen.findByRole("menu");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", menu.id);
    expect(menu).toHaveAttribute("aria-labelledby", trigger.id);
    expect(screen.queryByRole("menuitem", { name: "Hidden" })).toBeNull();
    const gated = screen.getByRole("menuitem", { name: "Sales Ops" });
    expect(gated).toHaveAttribute("aria-disabled", "true");
    expect(gated).toHaveAccessibleDescription("You can't start portals here");
    await expectNoAxeViolations(baseElement);

    await userEvent.click(gated);
    expect(items[1].onClick).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("runs a menu item from the keyboard", async () => {
    const items = menuItems();
    render(
      <SplitButton label="New portal" onClick={jest.fn()} menuItems={items} />
    );
    screen.getByRole("button", { name: "More options for New portal" }).focus();
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("menu");
    await userEvent.keyboard("{Enter}");
    expect(items[0].onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps a blocked main action focusable with its reason", async () => {
    const onClick = jest.fn();
    const { container } = render(
      <SplitButton
        label="New portal"
        onClick={onClick}
        gate={{ kind: "disable", reason: "Ask for access to start portals" }}
        menuItems={menuItems()}
      />
    );
    const main = screen.getByRole("button", { name: "New portal" });
    expect(main).toHaveAttribute("aria-disabled", "true");
    expect(main).toHaveAccessibleDescription("Ask for access to start portals");
    await userEvent.click(main);
    expect(onClick).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it("reads its pending label while the action runs", () => {
    render(
      <SplitButton
        label="New portal"
        onClick={jest.fn()}
        pending
        pendingLabel="Starting…"
        menuItems={menuItems()}
      />
    );
    const main = screen.getByRole("button", { name: "New portal" });
    expect(main).toHaveAttribute("aria-disabled", "true");
    expect(main).toHaveAccessibleDescription("Starting…");
  });

  it("hides entirely for a hide gate", () => {
    const { container } = render(
      <SplitButton
        label="New portal"
        onClick={jest.fn()}
        gate={{ kind: "hide" }}
        menuItems={menuItems()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is a plain button when no menu item is visible", () => {
    render(
      <SplitButton
        label="New portal"
        onClick={jest.fn()}
        menuItems={[{ label: "x", onClick: jest.fn(), gate: { kind: "hide" } }]}
      />
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("shows its name in a tooltip when it's only an icon", async () => {
    render(
      <SplitButton
        label="New portal in Sales Ops"
        onClick={jest.fn()}
        layout="icon"
        menuItems={menuItems()}
      />
    );
    await userEvent.hover(
      screen.getByRole("button", { name: /^New portal in Sales Ops$/ })
    );
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "New portal in Sales Ops"
    );
  });

  it("names its menu button in a tooltip", async () => {
    render(
      <SplitButton
        label="New portal"
        onClick={jest.fn()}
        menuItems={menuItems()}
      />
    );
    await userEvent.hover(
      screen.getByRole("button", { name: "More options for New portal" })
    );
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "More options for New portal"
    );
  });

  it("has no name tooltip on a labelled main action", async () => {
    render(
      <SplitButton
        label="New portal"
        onClick={jest.fn()}
        menuItems={menuItems()}
      />
    );
    await userEvent.hover(screen.getByRole("button", { name: /^New portal$/ }));
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows only icons, named by its label, in the icon layout", async () => {
    const { container } = render(
      <SplitButton
        label="New portal in Sales Ops"
        onClick={jest.fn()}
        layout="icon"
        menuItems={menuItems()}
      />
    );
    const main = screen.getByRole("button", {
      name: "New portal in Sales Ops",
    });
    expect(main).not.toHaveTextContent("New portal");
    await expectNoAxeViolations(container);
  });
});
