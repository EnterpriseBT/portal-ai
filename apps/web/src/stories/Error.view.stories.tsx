import type { Meta, StoryObj } from "@storybook/react";
import { ErrorView } from "../views/Error.view";
import { Box } from "@mcp-ui/core";

const meta = {
  title: "Views/ErrorView",
  component: ErrorView,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    message: {
      control: "text",
      description: "Error message to display",
    },
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: 400, height: 300, border: "1px dashed grey" }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof ErrorView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomMessage: Story = {
  args: {
    message: "Authentication failed. Please try again.",
  },
};

export const NetworkError: Story = {
  args: {
    message: "Network error. Please check your connection.",
  },
};

export const GenericError: Story = {
  args: {
    message: "Something went wrong. Please contact support.",
  },
};
