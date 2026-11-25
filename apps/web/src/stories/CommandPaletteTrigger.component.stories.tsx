import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { CommandPaletteTriggerUI } from "../components/CommandPaletteTrigger.component";

/** #1122: the header's search box that opens the palette. */
const meta = {
  title: "Launcher/CommandPaletteTrigger",
  component: CommandPaletteTriggerUI,
  parameters: { layout: "centered" },
  args: { onOpen: fn(), platform: "mac" },
} satisfies Meta<typeof CommandPaletteTriggerUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mac: Story = {};
export const Windows: Story = { args: { platform: "other" } };
