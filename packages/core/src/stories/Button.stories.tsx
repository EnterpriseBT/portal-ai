import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../Button";
import Icon, { IconName } from "../Icon";

const meta = {
  title: "Components/Button",
  component: Button,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["text", "contained", "outlined"],
      description: "The variant of the button",
    },
    color: {
      control: "select",
      options: ["primary", "secondary", "success", "error", "info", "warning"],
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
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "Button",
    variant: "contained",
    color: "primary",
    size: "medium",
    disabled: false,
  },
};

export const StartIcon: Story = {
  args: {
    children: "With Icon",
    variant: "contained",
    color: "primary",
    size: "medium",
    disabled: false,
    startIcon: <Icon name={IconName.Home} />,
  },
};
export const EndIcon: Story = {
  args: {
    children: "With Icon",
    variant: "contained",
    color: "primary",
    size: "medium",
    disabled: false,
    endIcon: <Icon name={IconName.ArrowForward} />,
  },
};
