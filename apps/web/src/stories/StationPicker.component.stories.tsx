import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { StationPickerUI } from "../components/StationPicker.component";
import { STATIONS } from "./dashboard-fixtures";

/** #1123: the start box's station chip; favorites list first. */
const meta = {
  title: "Dashboard/StationPicker",
  component: StationPickerUI,
  parameters: { layout: "centered" },
  args: { stations: STATIONS, selectedId: "s1", onSelect: fn() },
} satisfies Meta<typeof StationPickerUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Selected: Story = {};
/** Nothing selected: the chip asks for one. */
export const PickAStation: Story = { args: { selectedId: null } };
export const NoFavorites: Story = {
  args: { stations: STATIONS.map((s) => ({ ...s, favorite: false })) },
};
export const NoStations: Story = { args: { stations: [], selectedId: null } };
