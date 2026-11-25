import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";

import { GatedMenu } from "../../ui/GatedMenu";
import { expectNoAxeViolations } from "../axe.util";

describe("GatedMenu (#1122)", () => {
  it("lists items, keeps a gated one focusable with its reason, and calls an upsell's upgrade", async () => {
    const onClose = jest.fn();
    const onUpgrade = jest.fn();
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    render(
      <GatedMenu
        anchorEl={anchor}
        open
        onClose={onClose}
        items={[
          { label: "Open", onClick: jest.fn() },
          {
            label: "Share",
            onClick: jest.fn(),
            gate: { kind: "disable", reason: "Ask for access to share" },
          },
          {
            label: "Export",
            onClick: jest.fn(),
            gate: { kind: "upsell", reason: "On a higher plan", onUpgrade },
          },
        ]}
      />
    );
    expect(
      screen.getByRole("menuitem", { name: "Share" })
    ).toHaveAccessibleDescription("Ask for access to share");
    await expectNoAxeViolations(screen.getByRole("menu"));
    // #793: the gated item is reachable from the keyboard, to read why.
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Share" })).toHaveFocus();
    await userEvent.click(screen.getByRole("menuitem", { name: "Export" }));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("heads its sections, divides them, and skips both with the keys", async () => {
    const onChoose = jest.fn();
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    render(
      <GatedMenu
        anchorEl={anchor}
        open
        onClose={jest.fn()}
        items={[
          {
            label: "New portal in Sales Ops",
            section: "On this page",
            onClick: jest.fn(),
          },
          {
            label: "Star a station to add it here",
            section: "Favorite stations",
            hint: true,
            onClick: jest.fn(),
          },
          { label: "Choose station…", onClick: onChoose },
        ]}
      />
    );
    const menu = screen.getByRole("menu");
    expect(screen.getByText("On this page")).toBeInTheDocument();
    expect(screen.getByText("Favorite stations")).toBeInTheDocument();
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    const hint = screen.getByRole("menuitem", {
      name: "Star a station to add it here",
    });
    expect(hint).toHaveAttribute("aria-disabled", "true");
    expect(hint).toHaveAccessibleDescription("Favorite stations");
    expect(
      screen.getByRole("menuitem", { name: "New portal in Sales Ops" })
    ).toHaveAccessibleDescription("On this page");
    expect(
      screen.getByRole("menuitem", { name: "Choose station…" })
    ).not.toHaveAttribute("aria-describedby");
    await expectNoAxeViolations(menu);

    // Focus starts on the first item; the keys move item to item.
    await userEvent.keyboard("{ArrowDown}");
    expect(hint).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("menuitem", { name: "Choose station…" })
    ).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onChoose).toHaveBeenCalledTimes(1);
  });
});
