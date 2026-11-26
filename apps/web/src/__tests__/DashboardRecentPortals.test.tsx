import { jest } from "@jest/globals";

const { expectNoAxeViolations, render, screen, within } =
  await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { DashboardRecentPortalsUI } =
  await import("../components/DashboardRecentPortals.component");

const portal = (n: number) => ({
  id: `p${n}`,
  name: `Portal ${n}`,
  stationName: `Station ${n}`,
  created: Date.now() - n * 3600_000,
  lastOpened: null,
});

describe("DashboardRecentPortalsUI", () => {
  it("lists each portal on one line, linked, with its station and time", async () => {
    const { container } = render(
      <DashboardRecentPortalsUI portals={[portal(1), portal(2)]} />
    );
    const link = screen.getByRole("link", { name: /^Portal 1/ });
    expect(link).toHaveAttribute("href", "/portals/p1");
    // One line: the name, then its station and when it was last opened.
    expect(link).toHaveTextContent("Portal 1Station 1 · 1h ago");
    expect(screen.getByText("Station 2 · 2h ago")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("shows at most five, with no see-all", () => {
    render(
      <DashboardRecentPortalsUI portals={[1, 2, 3, 4, 5, 6].map(portal)} />
    );
    const list = screen.getByRole("list", { name: "Recent portals" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByText("Portal 6")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /see all/i })
    ).not.toBeInTheDocument();
  });

  it("shows a teaching empty state", async () => {
    const { container } = render(<DashboardRecentPortalsUI portals={[]} />);
    expect(screen.getByText("No portals yet")).toBeInTheDocument();
    expect(
      screen.getByText(/The ones you open most recently show here/)
    ).toBeInTheDocument();
    // It names no control the page may not have yet (#1079, #1080).
    expect(screen.queryByText(/Ask a question above/)).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("offers Delete on each row the caller may delete, naming the row", async () => {
    const onDeletePortal = jest.fn();
    const { container } = render(
      <DashboardRecentPortalsUI
        portals={[
          { ...portal(1), deleteGate: { kind: "allow" } },
          { ...portal(2), deleteGate: { kind: "hide" } },
        ]}
        onDeletePortal={onDeletePortal}
      />
    );
    const del = screen.getByRole("button", { name: "Delete Portal 1" });
    // Beside the row's link, not inside it.
    expect(
      screen.getByRole("link", { name: /^Portal 1/ })
    ).not.toContainElement(del);
    expect(
      screen.queryByRole("button", { name: "Delete Portal 2" })
    ).not.toBeInTheDocument();
    await userEvent.click(del);
    expect(onDeletePortal).toHaveBeenCalledWith("p1", "Portal 1");
    await expectNoAxeViolations(container);
  });

  it("offers no Delete without a handler", () => {
    render(
      <DashboardRecentPortalsUI
        portals={[{ ...portal(1), deleteGate: { kind: "allow" } }]}
      />
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows when a portal was last opened, falling back to when it was made", () => {
    render(
      <DashboardRecentPortalsUI
        portals={[
          { ...portal(1), lastOpened: Date.now() - 5 * 60_000 },
          { ...portal(2), lastOpened: null },
        ]}
      />
    );
    expect(screen.getByText("Station 1 · 5m ago")).toBeInTheDocument();
    expect(screen.getByText("Station 2 · 2h ago")).toBeInTheDocument();
  });

  it("shows only the time for a portal with no station", () => {
    render(
      <DashboardRecentPortalsUI
        portals={[{ ...portal(1), stationName: null }]}
      />
    );
    expect(screen.getByRole("link", { name: /^Portal 1/ })).toHaveTextContent(
      "Portal 11h ago"
    );
  });

  it("keeps no empty action slot on a row whose Delete is hidden", () => {
    const { container } = render(
      <DashboardRecentPortalsUI
        portals={[{ ...portal(1), deleteGate: { kind: "hide" } }]}
        onDeletePortal={jest.fn()}
      />
    );
    expect(
      container.querySelector(".MuiListItemSecondaryAction-root")
    ).toBeNull();
  });
});
