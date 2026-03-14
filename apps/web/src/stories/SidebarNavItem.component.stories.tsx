import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import { IconName } from "@portalai/core/ui";
import { SidebarNavItemUI } from "../components/SidebarNavItem.component";

const meta = {
  title: "Components/SidebarNavItemUI",
  component: SidebarNavItemUI,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    icon: IconName.Home,
    label: "Dashboard",
    onClick: fn(),
    onToggle: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof SidebarNavItemUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ExpandedNoChildren: Story = {
  args: {
    collapsed: false,
  },
};

export const CollapsedNoChildren: Story = {
  args: {
    collapsed: true,
  },
};

const childItems = [
  { label: "Sub Item 1", onClick: fn() },
  { label: "Sub Item 2", onClick: fn() },
];

export const WithChildrenClosed: Story = {
  args: {
    collapsed: false,
    open: false,
    items: childItems,
  },
};

export const WithChildrenOpen: Story = {
  args: {
    collapsed: false,
    open: true,
    items: childItems,
  },
};

export const CollapsedWithChildren: Story = {
  args: {
    collapsed: true,
    open: false,
    items: childItems,
  },
};

export const Selected: Story = {
  args: {
    collapsed: false,
    selected: true,
  },
};

export const ChildSelected: Story = {
  args: {
    collapsed: false,
    open: true,
    items: [
      { label: "Sub Item 1", onClick: fn(), selected: true },
      { label: "Sub Item 2", onClick: fn() },
    ],
  },
};
