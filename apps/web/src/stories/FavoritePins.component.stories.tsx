import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import {
  FavoritePinsUI,
  type FavoritePinItem,
} from "../components/FavoritePins.component";
import {
  FixtureChart,
  FixtureMap,
  FixtureTable,
} from "./dashboard-tile-fixtures";

const PINS: FavoritePinItem[] = [
  {
    pin: { id: "r1", title: "Q3 variance by region" },
    status: "ready",
    content: <FixtureChart />,
  },
  {
    pin: { id: "r2", title: "Open inspections by county" },
    status: "ready",
    content: <FixtureTable />,
  },
  {
    pin: { id: "r3", title: "Inspection sites" },
    status: "ready",
    content: <FixtureMap />,
  },
  { pin: { id: "r4", title: "Churn drivers" }, status: "loading" },
  { pin: { id: "r5", title: "Late shipments" }, status: "error" },
];

/** #1123: the dashboard's favorite pins. */
const meta = {
  title: "Dashboard/FavoritePins",
  component: FavoritePinsUI,
  parameters: { layout: "padded" },
  args: { pins: PINS, onRetry: fn() },
} satisfies Meta<typeof FavoritePinsUI>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Ready, loading and failed tiles together. */
export const Populated: Story = {};
/** Eight starred, six shown. */
export const Capped: Story = {
  args: {
    pins: [
      ...PINS,
      { pin: { id: "r6", title: "Accrual review" }, status: "loading" },
      { pin: { id: "r7", title: "Campaign attribution" }, status: "loading" },
      { pin: { id: "r8", title: "Board summary" }, status: "loading" },
    ],
  },
};
export const Empty: Story = { args: { pins: [] } };
