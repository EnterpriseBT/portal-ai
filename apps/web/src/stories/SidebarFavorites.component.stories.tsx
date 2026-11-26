import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { SidebarFavoritesUI } from "../components/SidebarFavorites.component";
import type { LauncherItem } from "../utils/launcher-items.util";
import { FAVORITES } from "./launcher-fixtures";

const MANY: LauncherItem[] = [
  ...FAVORITES,
  ...Array.from({ length: 7 }, (_, i) => ({
    id: `x${i}`,
    type: "curated_view" as const,
    name: `View ${i + 1}`,
    href: `/views/x${i}`,
  })),
];

/** #1122: the sidebar's Favorites group, from props, at sidebar width. */
const meta = {
  title: "Launcher/SidebarFavorites",
  component: SidebarFavoritesUI,
  args: {
    items: FAVORITES,
    collapsed: false,
    open: true,
    onToggle: fn(),
    onNavigate: fn(),
    activeHref: "/portal-results/p1",
  },
  decorators: [
    (Story, context) => (
      <nav
        aria-label="Primary"
        style={{ width: context.args.collapsed ? 72 : 260 }}
      >
        <Story />
      </nav>
    ),
  ],
  render: function Render(args) {
    const [open, setOpen] = React.useState(args.open);
    return (
      <SidebarFavoritesUI
        {...args}
        open={open}
        onToggle={() => {
          setOpen((value) => !value);
          args.onToggle();
        }}
      />
    );
  },
} satisfies Meta<typeof SidebarFavoritesUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** More than the cap: 8 shown, then "Show all (12)". */
export const Capped: Story = { args: { items: MANY } };

export const Closed: Story = { args: { open: false } };

/** The sidebar collapsed to icons; hover or focus shows each name. */
export const Collapsed: Story = { args: { items: MANY, collapsed: true } };

export const Empty: Story = { args: { items: [] } };

export const LongNames: Story = {
  args: {
    items: [
      {
        id: "l",
        type: "station",
        name: "Quarterly revenue reconciliation for EMEA channel partners",
        href: "/stations/l",
      },
      ...FAVORITES,
    ],
  },
};
