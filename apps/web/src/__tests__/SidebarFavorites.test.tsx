import type React from "react";

import { jest } from "@jest/globals";

import type { LauncherItem } from "../utils/launcher-items.util";

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { SidebarFavoritesUI } =
  await import("../components/SidebarFavorites.component");

const items: LauncherItem[] = Array.from({ length: 12 }, (_, i) => ({
  id: `s${i}`,
  type: i % 2 ? ("pin" as const) : ("station" as const),
  name: `Favorite ${i + 1}`,
  href: `/stations/s${i}`,
}));

const props = (overrides = {}) => ({
  items,
  collapsed: false,
  open: true,
  onToggle: jest.fn(),
  ...overrides,
});

// The list renders inside a nav, as the sidebar does.
const inNav = (ui: React.ReactElement) => <nav aria-label="Primary">{ui}</nav>;

describe("SidebarFavoritesUI (#1122)", () => {
  it("is a disclosure listing favorites as links, capped with Show all", async () => {
    const p = props();
    const { container } = render(inNav(<SidebarFavoritesUI {...p} />));
    const toggle = screen.getByRole("button", { name: "Favorites" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("link")).toHaveLength(8);
    expect(screen.getByRole("link", { name: "Favorite 1" })).toHaveAttribute(
      "href",
      "/stations/s0"
    );
    await expectNoAxeViolations(container);

    // The group's star is the favorite colour; its entries, a level below
    // the nav items, have smaller primary-coloured icons.
    expect(toggle.querySelector("svg")).toHaveClass("MuiSvgIcon-colorFavorite");
    const entryIcon = screen
      .getByRole("link", { name: "Favorite 1" })
      .querySelector("svg");
    expect(entryIcon).toHaveClass("MuiSvgIcon-colorPrimary");
    expect(entryIcon).toHaveClass("MuiSvgIcon-fontSizeSmall");

    await userEvent.click(
      screen.getByRole("button", { name: "Show all (12)" })
    );
    expect(screen.getAllByRole("link")).toHaveLength(12);
    await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.getAllByRole("link")).toHaveLength(8);

    await userEvent.click(toggle);
    expect(p.onToggle).toHaveBeenCalledTimes(1);
  });

  it("has no Show all when the favorites fit", () => {
    render(
      inNav(<SidebarFavoritesUI {...props({ items: items.slice(0, 3) })} />)
    );
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("marks the current page's favorite", () => {
    render(
      inNav(<SidebarFavoritesUI {...props({ activeHref: "/stations/s2" })} />)
    );
    expect(screen.getByRole("link", { name: "Favorite 3" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(
      screen.getByRole("link", { name: "Favorite 1" })
    ).not.toHaveAttribute("aria-current");
  });

  it("shows icons named by their favorites when the sidebar is collapsed", async () => {
    const { container } = render(
      inNav(<SidebarFavoritesUI {...props({ collapsed: true })} />)
    );
    expect(screen.queryByRole("button", { name: "Favorites" })).toBeNull();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(8);
    expect(links[0]).toHaveAccessibleName("Favorite 1");
    // Collapsed to icons, entries keep their colour at full size.
    expect(links[0].querySelector("svg")).toHaveClass(
      "MuiSvgIcon-colorPrimary"
    );
    expect(links[0].querySelector("svg")).not.toHaveClass(
      "MuiSvgIcon-fontSizeSmall"
    );
    expect(screen.queryByText("Favorite 1")).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("teaches how to add favorites when there are none", async () => {
    const { container } = render(
      inNav(<SidebarFavoritesUI {...props({ items: [] })} />)
    );
    expect(
      screen.getByText(/Star a station, pinned result/)
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("shows nothing collapsed with no favorites", () => {
    render(
      inNav(<SidebarFavoritesUI {...props({ items: [], collapsed: true })} />)
    );
    expect(screen.getByRole("navigation")).toBeEmptyDOMElement();
  });

  it("reports a followed favorite (#1077: the sidebar closes its mobile drawer)", async () => {
    const onNavigate = jest.fn();
    render(inNav(<SidebarFavoritesUI {...props({ onNavigate })} />));
    await userEvent.click(screen.getByRole("link", { name: "Favorite 1" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
