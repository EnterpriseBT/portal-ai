import type { Meta, StoryObj } from "@storybook/react";

import { Kbd } from "../ui/Kbd";

/** #1122: a keycap for shortcut hints. */
const meta = {
  title: "Components/Kbd",
  component: Kbd,
  parameters: { layout: "centered" },
  args: { children: "⌘K" },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mac: Story = {};
export const Windows: Story = { args: { children: "Ctrl K" } };
export const SingleKey: Story = { args: { children: "↵" } };
