import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { FavoriteStationCardUI } from "../components/FavoriteStationCard.component";
import { FAVORITE_STATIONS } from "./dashboard-fixtures";

/** #1123: a favorite station with one-click Launch. */
const meta = {
  title: "Dashboard/FavoriteStationCard",
  component: FavoriteStationCardUI,
  parameters: { layout: "padded" },
  args: { ...FAVORITE_STATIONS[0], onLaunch: fn() },
} satisfies Meta<typeof FavoriteStationCardUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const NoPortalsYet: Story = { args: { ...FAVORITE_STATIONS[2] } };
export const Launching: Story = { args: { launching: true } };
export const DisabledWithReason: Story = {
  args: {
    launchGate: {
      kind: "disable",
      reason: "Ask for access to start portals in this station",
    },
  },
};
export const Hidden: Story = { args: { launchGate: { kind: "hide" } } };
