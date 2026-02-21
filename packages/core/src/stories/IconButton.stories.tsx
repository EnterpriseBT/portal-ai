import type { Meta, StoryObj } from "@storybook/react";
import { IconButton } from "../ui/IconButton";
import { IconName } from "../ui/Icon";

const meta = {
  title: "Components/IconButton",
  component: IconButton,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    icon: {
      control: "select",
      options: Object.values(IconName),
      description: "The icon to display in the button",
    },
    color: {
      control: "select",
      options: [
        "default",
        "primary",
        "secondary",
        "success",
        "error",
        "info",
        "warning",
      ],
      description: "The color of the button",
    },
    size: {
      control: "select",
      options: ["small", "medium", "large"],
      description: "The size of the button",
    },
    disabled: {
      control: "boolean",
      description: "Whether the button is disabled",
    },
    onClick: { action: "clicked" },
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    icon: IconName.Home,
    color: "default",
    size: "medium",
    disabled: false,
  },
};
