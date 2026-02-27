import type { Meta, StoryObj } from "@storybook/react";
import { StatusMessage } from "../ui/StatusMessage";

const meta = {
  title: "Components/StatusMessage",
  component: StatusMessage,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["error", "warning", "info", "success"],
      description: "The variant of the status message",
    },
    message: {
      control: "text",
      description: "The message to display",
    },
    loading: {
      control: "boolean",
      description: "Whether to show a loading spinner",
    },
    tooltip: {
      control: "text",
      description: "Tooltip text shown on hover",
    },
  },
} satisfies Meta<typeof StatusMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    message: "This is an informational message",
    variant: "info",
  },
};

export const Error: Story = {
  args: {
    message: "Something went wrong",
    variant: "error",
  },
};

export const Warning: Story = {
  args: {
    message: "Please check your input",
    variant: "warning",
  },
};

export const Success: Story = {
  args: {
    message: "Operation completed successfully",
    variant: "success",
  },
};

export const Loading: Story = {
  args: {
    message: "Loading data...",
    loading: true,
  },
};

export const ErrorWithObject: Story = {
  args: {
    variant: "error",
    error: new globalThis.Error("Network request failed"),
  },
};

export const WithTooltip: Story = {
  args: {
    message: "Hover for details",
    variant: "warning",
    tooltip: "This action may take a while to complete",
  },
};
