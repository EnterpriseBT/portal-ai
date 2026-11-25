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
    await userEvent.click(screen.getByRole("menuitem", { name: "Export" }));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});
