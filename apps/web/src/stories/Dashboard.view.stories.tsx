import type { Meta, StoryObj } from "@storybook/react";
import { DashboardView } from "../views/Dashboard.view";

const meta = {
  title: "Views/DashboardView",
  component: DashboardView,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof DashboardView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
