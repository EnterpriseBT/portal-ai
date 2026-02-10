import type { Meta, StoryObj } from "@storybook/react";
import { LoadingView } from "../views/Loading.view";
import { Box } from "@mcp-ui/core";

const meta = {
  title: "Views/LoadingView",
  component: LoadingView,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Box sx={{ width: 400, height: 300, border: "1px dashed grey" }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof LoadingView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
