import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Box from "@mui/material/Box";

import { ActionsSuite } from "../ui/ActionsSuite";
import { Icon, IconName } from "../ui/Icon";

const meta = {
  title: "Components/ActionsSuite",
  component: ActionsSuite,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["small", "medium", "large"],
      description: "Button size applied to all items",
    },
  },
} satisfies Meta<typeof ActionsSuite>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    items: [
      { label: "Edit", onClick: () => console.log("Edit") },
      { label: "Duplicate", onClick: () => console.log("Duplicate") },
      { label: "Delete", onClick: () => console.log("Delete"), color: "error" },
    ],
  },
};

export const WithIcons: Story = {
  args: {
    items: [
      {
        label: "Edit",
        icon: <Icon name={IconName.Settings} sx={{ fontSize: 18 }} />,
        onClick: () => console.log("Edit"),
      },
      {
        label: "Refresh",
        icon: <Icon name={IconName.Refresh} sx={{ fontSize: 18 }} />,
        onClick: () => console.log("Refresh"),
      },
      {
        label: "Delete",
        icon: <Icon name={IconName.Delete} sx={{ fontSize: 18 }} />,
        onClick: () => console.log("Delete"),
        color: "error",
      },
    ],
  },
};

export const MixedVariants: Story = {
  args: {
    items: [
      {
        label: "Launch",
        icon: <Icon name={IconName.Portal} sx={{ fontSize: 18 }} />,
        onClick: () => console.log("Launch"),
        variant: "contained",
      },
      { label: "Edit", onClick: () => console.log("Edit") },
      { label: "Delete", onClick: () => console.log("Delete"), color: "error" },
    ],
  },
};

export const WithDisabled: Story = {
  args: {
    items: [
      { label: "Edit", onClick: () => console.log("Edit") },
      {
        label: "Archive",
        onClick: () => console.log("Archive"),
        disabled: true,
      },
      { label: "Delete", onClick: () => console.log("Delete"), color: "error" },
    ],
  },
};

export const SingleAction: Story = {
  args: {
    items: [
      {
        label: "Open Portal",
        icon: <Icon name={IconName.Portal} sx={{ fontSize: 18 }} />,
        onClick: () => console.log("Open"),
        variant: "contained",
      },
    ],
  },
};

export const MediumSize: Story = {
  args: {
    size: "medium",
    items: [
      { label: "Edit", onClick: () => console.log("Edit") },
      { label: "Duplicate", onClick: () => console.log("Duplicate") },
      { label: "Delete", onClick: () => console.log("Delete"), color: "error" },
    ],
  },
};

export const Wrapping: Story = {
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 300 }}>
        <Story />
      </Box>
    ),
  ],
  args: {
    items: [
      { label: "Edit", onClick: () => console.log("Edit") },
      { label: "Duplicate", onClick: () => console.log("Duplicate") },
      { label: "Archive", onClick: () => console.log("Archive") },
      { label: "Export", onClick: () => console.log("Export") },
      { label: "Delete", onClick: () => console.log("Delete"), color: "error" },
    ],
  },
};
