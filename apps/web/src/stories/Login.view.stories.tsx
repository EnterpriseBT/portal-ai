import type { Meta, StoryObj } from "@storybook/react";
import { LoginView } from "../views/Login.view";
import { Box } from "@portalai/core/ui";

const meta = {
  title: "Views/LoginView",
  component: LoginView,
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
} satisfies Meta<typeof LoginView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
