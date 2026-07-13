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
  it("renders nothing when the user has no orgs", () => {
    const { container } = renderWithTheme(
      <OrgSwitcherUI memberships={[]} onSwitch={jest.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a single org as a plain label with no dropdown", () => {
    renderWithTheme(
      <OrgSwitcherUI
        memberships={[org("o-1", "Solo Org", true)]}
        onSwitch={jest.fn()}
      />
    );
    expect(screen.getByText("Solo Org")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows a dropdown with the current org selected and switches on pick", async () => {
    const onSwitch = jest.fn();
    renderWithTheme(
      <OrgSwitcherUI
        memberships={[org("o-1", "Acme", true), org("o-2", "Beta", false)]}
        onSwitch={onSwitch}
      />
    );
    const combo = screen.getByRole("combobox");
    expect(combo).toHaveTextContent("Acme"); // current org is the value

    fireEvent.mouseDown(combo);
    fireEvent.click(await screen.findByRole("option", { name: "Beta" }));
    expect(onSwitch).toHaveBeenCalledWith("o-2");
  });

  it("disables the dropdown while a switch is in flight", () => {
    renderWithTheme(
      <OrgSwitcherUI
        memberships={[org("o-1", "Acme", true), org("o-2", "Beta", false)]}
        onSwitch={jest.fn()}
        isSwitching
      />
    );
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });
});
