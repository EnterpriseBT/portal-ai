import type { Meta, StoryObj } from "@storybook/react";

import { TypingIndicator } from "../components/TypingIndicator.component";

const meta: Meta<typeof TypingIndicator> = {
  title: "Components/TypingIndicator",
  component: TypingIndicator,
};

export default meta;

type Story = StoryObj<typeof TypingIndicator>;

export const Default: Story = {};

export const CustomAriaLabel: Story = {
  args: {
    ariaLabel: "Working on your request",
  },
};
