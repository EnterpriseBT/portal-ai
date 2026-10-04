import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { GatedButton } from "../ui/GatedButton";
import { GatedIconButton } from "../ui/GatedIconButton";
import { IconName } from "../ui/Icon";

/** #688: a CTA rendered from an ActionGate decided by the app. */
const meta = {
  title: "Components/GatedButton",
  component: GatedButton,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  // fn() spies, so the Actions panel shows that a disabled click never
  // reaches onClick and an upsell calls onUpgrade instead.
  args: { children: "Edit view", onClick: fn() },
} satisfies Meta<typeof GatedButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Allow: Story = { args: { gate: { kind: "allow" } } };

export const Disabled: Story = {
  args: { gate: { kind: "disable", reason: "A sync is running" } },
};

export const DisabledOutlined: Story = {
  args: {
    variant: "outlined",
    gate: { kind: "disable", reason: "A sync is running" },
  },
};

export const Upsell: Story = {
  args: {
    gate: {
      kind: "upsell",
      reason: "Custom toolpacks are on a higher plan",
      onUpgrade: fn(),
    },
  },
};

/** `hide` renders nothing. */
export const Hidden: Story = { args: { gate: { kind: "hide" } } };

export const IconButtonDisabled: Story = {
  render: () => (
    <GatedIconButton
      icon={IconName.Delete}
      aria-label="Delete view"
      gate={{ kind: "disable", reason: "An import is running" }}
    />
  ),
};
