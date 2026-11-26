import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { CommandPaletteOptionUI } from "../components/CommandPaletteOption.component";
import { FAVORITES } from "./launcher-fixtures";

/** #1122: one palette row's content, outside the list. */
const meta = {
  title: "Launcher/CommandPaletteOption",
  component: CommandPaletteOptionUI,
  parameters: { layout: "centered" },
} satisfies Meta<typeof CommandPaletteOptionUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Station: Story = {
  args: { entry: { kind: "item", ...FAVORITES[0] } },
};

export const PinWithTags: Story = {
  args: { entry: { kind: "item", ...FAVORITES[2] } },
};

export const Action: Story = {
  args: {
    entry: { kind: "action", id: "new", label: "Open Portal", onSelect: fn() },
  },
};

export const GatedAction: Story = {
  args: {
    entry: {
      kind: "action",
      id: "invite",
      label: "Invite a member",
      onSelect: fn(),
      gate: { kind: "disable", reason: "Needs member.invite" },
    },
  },
};

export const UpsellAction: Story = {
  args: {
    entry: {
      kind: "action",
      id: "toolpack",
      label: "Register a toolpack",
      onSelect: fn(),
      gate: { kind: "upsell", reason: "On a higher plan", onUpgrade: fn() },
    },
  },
};
