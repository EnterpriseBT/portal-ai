import type { Meta, StoryObj } from "@storybook/react";
import { Header } from "../components/Header.component";
import { Button } from "@mcp-ui/core/ui";

const meta = {
  title: "Components/Header",
  component: Header,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const WithChildren: Story = {
  args: {
    title: "Dashboard",
    children: (
      <Button variant="contained" color="secondary">
        Logout
      </Button>
    ),
  },
};
