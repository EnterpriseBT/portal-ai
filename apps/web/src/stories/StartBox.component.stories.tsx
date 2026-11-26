import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { StartBoxUI } from "../components/StartBox.component";
import { STATIONS } from "./dashboard-fixtures";

/** #1123: type a question, pick a station, start a portal. */
const meta = {
  title: "Dashboard/StartBox",
  component: StartBoxUI,
  parameters: { layout: "padded" },
  args: {
    stations: STATIONS,
    initialStationId: "s1",
    pending: false,
    serverError: null,
    onStart: fn(),
  },
} satisfies Meta<typeof StartBoxUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
/** Nothing preselected: Start says to pick one. */
export const PickAStation: Story = { args: { initialStationId: null } };
export const Pending: Story = { args: { pending: true } };
export const InlineError: Story = {
  args: {
    serverError: {
      message: "The station couldn't start a portal. Try again.",
      code: "PORTAL_CREATE_FAILED",
    },
  },
};
export const DisabledWithReason: Story = {
  args: {
    gate: { kind: "disable", reason: "Ask for access to start portals" },
  },
};
export const Upsell: Story = {
  args: {
    gate: {
      kind: "upsell",
      reason: "Your plan's portal sessions are used up for this period",
      onUpgrade: fn(),
    },
  },
};
