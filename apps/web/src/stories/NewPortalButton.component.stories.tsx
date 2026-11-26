import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { NewPortalButtonUI } from "../components/NewPortalButton.component";

/** #1122: the header's Open Portal split button, from props. */
const meta = {
  title: "Launcher/NewPortalButton",
  component: NewPortalButtonUI,
  parameters: { layout: "centered" },
  args: {
    station: { id: "s1", name: "Sales Ops" },
    onLaunch: fn(),
    pageStation: { id: "s1", name: "Sales Ops" },
    favoriteStations: [
      { id: "s2", name: "Field Inspections" },
      { id: "s3", name: "Finance Close" },
      { id: "s4", name: "Customer Health" },
    ],
    onLaunchIn: fn(),
    onChooseStation: fn(),
  },
} satisfies Meta<typeof NewPortalButtonUI>;

export default meta;
type Story = StoryObj<typeof meta>;

/** On a station's page. */
export const OnStationPage: Story = {};

/** Anywhere else: the default station, no "On this page". */
export const ElsewhereDefaultStation: Story = {
  args: { station: { id: "d", name: "My Station" }, pageStation: null },
};

/** No favorites yet: the menu teaches how to add some. */
export const NoFavorites: Story = {
  args: { favoriteStations: [], pageStation: null },
};

/** No usable station: the main click chooses one. */
export const NoStation: Story = {
  args: { station: null, pageStation: null },
};

export const Disabled: Story = {
  args: {
    gate: { kind: "disable", reason: "Ask for access to start portals" },
  },
};

export const Starting: Story = { args: { pending: true } };

/** The view picks this at narrow widths. */
export const Narrow: Story = { args: { layout: "icon" } };

export const LongNames: Story = {
  args: {
    station: {
      id: "x",
      name: "Quarterly revenue reconciliation for EMEA partners",
    },
    favoriteStations: [
      {
        id: "y",
        name: "Operational field inspections across all northern regions",
      },
    ],
  },
};
