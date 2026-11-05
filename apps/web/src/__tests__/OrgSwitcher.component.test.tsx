import { jest } from "@jest/globals";
import React from "react";
import { render, screen, fireEvent, expectNoAxeViolations } from "./test-utils";
import MenuList from "@mui/material/MenuList";
import { ThemeProvider } from "@portalai/core/ui";

import { OrgSwitcherUI } from "../components/OrgSwitcher.component";
import type { UserMembership } from "@portalai/core/contracts";

const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

const org = (id: string, name: string, isCurrent: boolean): UserMembership => ({
  organization: {
    id,
    name,
    timezone: "UTC",
    ownerUserId: "u-1",
    defaultStationId: null,
    tier: "standard",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    billingAnchorDay: null,
    marketplaceEntitlementId: null,
    entitlementThrough: null,
    created: 1,
    createdBy: "SYSTEM",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  },
  isCurrent,
});

describe("OrgSwitcherUI", () => {
  it("renders nothing when the user has no orgs", () => {
    const { container } = renderWithTheme(
      <OrgSwitcherUI memberships={[]} onSwitch={jest.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a single org as a disabled item, with nothing to switch to (#797)", () => {
    renderWithTheme(
      <MenuList>
        <OrgSwitcherUI
          memberships={[org("o-1", "Solo Org", true)]}
          onSwitch={jest.fn()}
        />
      </MenuList>
    );
    expect(screen.getByRole("menuitem", { name: "Solo Org" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("lists several orgs as menu radio items, the current one checked (#797)", () => {
    renderWithTheme(
      <MenuList>
        <OrgSwitcherUI
          memberships={[org("o-1", "Acme", true), org("o-2", "Beta", false)]}
          onSwitch={jest.fn()}
        />
      </MenuList>
    );
    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Acme" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("menuitemradio", { name: "Beta" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("switches when another org is chosen, and not for the current one", () => {
    const onSwitch = jest.fn();
    renderWithTheme(
      <MenuList>
        <OrgSwitcherUI
          memberships={[org("o-1", "Acme", true), org("o-2", "Beta", false)]}
          onSwitch={onSwitch}
        />
      </MenuList>
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Acme" }));
    expect(onSwitch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Beta" }));
    expect(onSwitch).toHaveBeenCalledWith("o-2");
  });

  it("disables the choices while a switch is in flight", () => {
    renderWithTheme(
      <MenuList>
        <OrgSwitcherUI
          memberships={[org("o-1", "Acme", true), org("o-2", "Beta", false)]}
          onSwitch={jest.fn()}
          isSwitching
        />
      </MenuList>
    );
    expect(screen.getByRole("menuitemradio", { name: "Beta" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });

  it("has no axe violations", async () => {
    const { container } = renderWithTheme(
      <MenuList>
        <OrgSwitcherUI
          memberships={[org("o-1", "Acme", true), org("o-2", "Beta", false)]}
          onSwitch={jest.fn()}
        />
      </MenuList>
    );
    await expectNoAxeViolations(container);
  });
});
