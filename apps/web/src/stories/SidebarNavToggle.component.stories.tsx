import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import { SidebarNavToggleUI } from "../components/SidebarNavToggle.component";

const meta = {
  title: "Components/SidebarNavToggleUI",
  component: SidebarNavToggleUI,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    onClick: fn(),
  },
} satisfies Meta<typeof SidebarNavToggleUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {
  args: {
    collapsed: false,
  },
};

export const Collapsed: Story = {
  args: {
    collapsed: true,
  },
};
