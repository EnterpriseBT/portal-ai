import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { DashboardRecentPortalsUI } from "../components/DashboardRecentPortals.component";
import { RECENT_PORTALS } from "./dashboard-fixtures";

/** #1123: the dashboard's short Recent portals list (no "see all"). */
const meta = {
  title: "Dashboard/DashboardRecentPortals",
  component: DashboardRecentPortalsUI,
  parameters: { layout: "padded" },
  args: { portals: RECENT_PORTALS.slice(0, 3) },
} satisfies Meta<typeof DashboardRecentPortalsUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Few: Story = {};
/** Six portals in, five shown. */
export const Capped: Story = { args: { portals: RECENT_PORTALS } };
/** The teaching empty state. */
export const Empty: Story = { args: { portals: [] } };
/** #1078: Delete on each row the caller may delete; the second is someone
 *  else's portal, so it has none. */
export const WithDelete: Story = {
  args: {
    portals: RECENT_PORTALS.slice(0, 4).map((portal, i) => ({
      ...portal,
      deleteGate: { kind: i === 1 ? "hide" : "allow" },
    })),
    onDeletePortal: fn(),
  },
};
