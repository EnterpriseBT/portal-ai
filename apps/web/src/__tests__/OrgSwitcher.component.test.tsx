import { jest } from "@jest/globals";
import React from "react";
import { render, screen, fireEvent } from "./test-utils";
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
  it("renders nothing when the user belongs to fewer than 2 orgs", () => {
    const { container } = renderWithTheme(
      <OrgSwitcherUI memberships={[org("o-1", "Solo", true)]} onSwitch={jest.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Switch organization")).not.toBeInTheDocument();
  });

  it("lists one item per org with the current one checked", () => {
    renderWithTheme(
      <OrgSwitcherUI
        memberships={[org("o-1", "Acme", true), org("o-2", "Beta", false)]}
        onSwitch={jest.fn()}
      />
    );
    expect(screen.getByText("Switch organization")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    // The current org's item is selected (aria-selected) and disabled.
    const current = screen.getByRole("menuitem", { name: /Switch to Acme/i });
    expect(current).toHaveAttribute("aria-disabled", "true");
  });

  it("calls onSwitch with the org id when a non-current org is clicked", () => {
    const onSwitch = jest.fn();
    renderWithTheme(
      <OrgSwitcherUI
        memberships={[org("o-1", "Acme", true), org("o-2", "Beta", false)]}
        onSwitch={onSwitch}
      />
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Switch to Beta/i }));
    expect(onSwitch).toHaveBeenCalledWith("o-2");
  });

  it("disables every item while a switch is in flight", () => {
    const onSwitch = jest.fn();
    renderWithTheme(
      <OrgSwitcherUI
        memberships={[org("o-1", "Acme", true), org("o-2", "Beta", false)]}
        onSwitch={onSwitch}
        isSwitching
      />
    );
    const beta = screen.getByRole("menuitem", { name: /Switch to Beta/i });
    expect(beta).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(beta);
    expect(onSwitch).not.toHaveBeenCalled();
  });
});
