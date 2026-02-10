import type { Meta, StoryObj } from "@storybook/react";
import { Icon, IconName } from "../Icon";

const meta = {
  title: "Components/Icon",
  component: Icon,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    name: {
      control: "select",
      options: Object.values(IconName),
      description: "Icon name (includes both MUI and custom icons)",
    },
    color: {
      control: "select",
      options: [
        "inherit",
        "action",
        "disabled",
        "primary",
        "secondary",
        "error",
        "info",
        "success",
        "warning",
      ],
      description: "The color of the icon",
    },
    fontSize: {
      control: "select",
      options: ["inherit", "small", "medium", "large"],
      description: "The size of the icon",
    },
  },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    name: IconName.Home,
    color: "primary",
    fontSize: "medium",
  },
};
