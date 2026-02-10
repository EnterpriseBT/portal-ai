import type { Meta, StoryObj } from "@storybook/react";
import { PublicLayout } from "../layouts/Public.layout";
import { Box, Typography } from "@mcp-ui/core";

const meta = {
  title: "Layouts/PublicLayout",
  component: PublicLayout,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof PublicLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <Box>
        <Typography variant="h2">Page Content</Typography>
        <Typography variant="body1">
          This is example content inside the PublicLayout.
        </Typography>
      </Box>
    ),
  },
};
