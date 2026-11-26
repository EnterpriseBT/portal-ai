import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { SplitButton } from "../ui/SplitButton";

/**
 * #1122: a main action with a menu of related ones. Tab reaches both
 * halves; Enter or Space on the arrow opens the menu, arrows move, Escape
 * closes and returns focus to the arrow.
 */
const meta = {
  title: "Components/SplitButton",
  component: SplitButton,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  args: {
    label: "New portal in Sales Ops",
    onClick: fn(),
    menuItems: [
      { label: "On this page", onClick: fn() },
      { label: "Finance", onClick: fn() },
      { label: "Choose station…", onClick: fn() },
    ],
  },
} satisfies Meta<typeof SplitButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Outlined: Story = { args: { variant: "outlined" } };

/** A blocked main action stays focusable and reads its reason. */
export const Disabled: Story = {
  args: {
    gate: { kind: "disable", reason: "Ask for access to start portals" },
  },
};

export const Pending: Story = {
  args: { pending: true, pendingLabel: "Starting…" },
};

/** One menu item carries its own gate. */
export const GatedMenuItem: Story = {
  args: {
    menuItems: [
      { label: "On this page", onClick: fn() },
      {
        label: "Finance",
        onClick: fn(),
        gate: { kind: "disable", reason: "You can't start portals in Finance" },
      },
      { label: "Choose station…", onClick: fn() },
    ],
  },
};

/** The view picks `icon` at narrow widths; the label becomes its name. */
export const IconLayout: Story = { args: { layout: "icon" } };

export const Small: Story = { args: { size: "small" } };

export const LongLabel: Story = {
  args: {
    label: "New portal in Quarterly revenue reconciliation for EMEA partners",
  },
};

/** With no visible menu item it's a plain button. */
export const NoMenu: Story = { args: { menuItems: [] } };
