import type { Meta, StoryObj } from "@storybook/react";
import { Progress } from "../ui/Progress";

const meta = {
  title: "Components/Progress",
  component: Progress,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    value: {
      control: { type: "range", min: 0, max: 100 },
      description: "Current progress value (0–100)",
    },
    showLabel: {
      control: "boolean",
      description: "Whether to show the percentage label",
    },
    color: {
      control: "select",
      options: ["primary", "secondary", "success", "error", "warning", "info"],
      description: "Color of the progress bar",
    },
    height: {
      control: { type: "number", min: 2, max: 24 },
      description: "Height of the progress bar in pixels",
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 400 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: 45,
  },
};

export const Complete: Story = {
  args: {
    value: 100,
    color: "success",
  },
};

export const Error: Story = {
  args: {
    value: 30,
    color: "error",
  },
};

export const NoLabel: Story = {
  args: {
    value: 60,
    showLabel: false,
  },
};

export const Thick: Story = {
  args: {
    value: 75,
    height: 16,
  },
};

export const Zero: Story = {
  args: {
    value: 0,
  },
};
