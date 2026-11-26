import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { PinTileUI } from "../components/PinTile.component";
import {
  FixtureChart,
  FixtureMap,
  FixtureTable,
} from "./dashboard-tile-fixtures";

/** #1123: one favorite pin's tile on the dashboard. */
const meta = {
  title: "Dashboard/PinTile",
  component: PinTileUI,
  parameters: { layout: "padded" },
  args: {
    pin: { id: "r1", title: "Q3 variance by region" },
    status: "ready",
    onRetry: fn(),
    children: <FixtureChart />,
  },
} satisfies Meta<typeof PinTileUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Chart: Story = {};
export const TableBlock: Story = {
  args: {
    pin: { id: "r2", title: "Open inspections by county" },
    children: <FixtureTable />,
  },
};
export const MapBlock: Story = {
  args: {
    pin: { id: "r3", title: "Inspection sites" },
    children: <FixtureMap />,
  },
};
export const Loading: Story = { args: { status: "loading" } };
/** The block failed to load; Retry asks again. */
export const LoadError: Story = { args: { status: "error" } };
