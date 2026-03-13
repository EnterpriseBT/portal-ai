import type { Meta, StoryObj } from "@storybook/react";
import { StatusBadge } from "../ui/StatusBadge";

const meta = {
  title: "Components/StatusBadge",
  component: StatusBadge,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    status: {
      control: "select",
      options: ["pending", "active", "completed", "failed", "stalled", "cancelled"],
      description: "The status to display",
    },
    label: {
      control: "text",
      description: "Override the displayed label",
    },
    size: {
      control: "select",
      options: ["small", "medium"],
      description: "Chip size",
    },
  },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {
  args: { status: "pending" },
};

export const Active: Story = {
  args: { status: "active" },
};

export const Completed: Story = {
  args: { status: "completed" },
};

export const Failed: Story = {
  args: { status: "failed" },
};

export const Stalled: Story = {
  args: { status: "stalled" },
};

export const Cancelled: Story = {
  args: { status: "cancelled" },
};

export const CustomLabel: Story = {
  args: {
    status: "active",
    label: "In Progress",
  },
};

export const MediumSize: Story = {
  args: {
    status: "completed",
    size: "medium",
  },
};
