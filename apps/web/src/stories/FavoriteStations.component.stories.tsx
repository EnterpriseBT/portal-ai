import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { FavoriteStationsUI } from "../components/FavoriteStations.component";
import { FAVORITE_STATIONS } from "./dashboard-fixtures";

/** #1123: the dashboard's favorite stations. */
const meta = {
  title: "Dashboard/FavoriteStations",
  component: FavoriteStationsUI,
  parameters: { layout: "padded" },
  args: { items: FAVORITE_STATIONS, onLaunch: fn() },
} satisfies Meta<typeof FavoriteStationsUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};
/** The teaching empty state: nothing starred yet. */
export const Empty: Story = { args: { items: [] } };
