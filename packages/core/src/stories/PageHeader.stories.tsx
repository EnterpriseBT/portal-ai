import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import MuiTypography from "@mui/material/Typography";

import { PageHeader } from "../ui/PageHeader";
import { Button } from "../ui/Button";
import { Icon, IconName } from "../ui/Icon";

const meta = {
  title: "Components/PageHeader",
  component: PageHeader,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  argTypes: {
    title: {
      control: "text",
      description: "Page title displayed as h1",
    },
    childrenSpacing: {
      control: "number",
      description: "Spacing between children elements",
    },
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 960 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Stations",
    breadcrumbs: [{ label: "Home", href: "/" }, { label: "Stations" }],
  },
};

export const WithIcon: Story = {
  args: {
    title: "Stations",
    icon: <Icon name={IconName.Hub} />,
    breadcrumbs: [{ label: "Home", href: "/" }, { label: "Stations" }],
  },
};

export const WithPrimaryAction: Story = {
  args: {
    title: "Stations",
    icon: <Icon name={IconName.Hub} />,
    breadcrumbs: [{ label: "Home", href: "/" }, { label: "Stations" }],
    primaryAction: (
      <Button variant="contained" size="small">
        Create Station
      </Button>
    ),
  },
};

export const WithAllActions: Story = {
  args: {
    title: "Weather Station Alpha",
    icon: <Icon name={IconName.Hub} />,
    breadcrumbs: [
      { label: "Home", href: "/" },
      { label: "Stations", href: "/stations" },
      { label: "Weather Station Alpha" },
    ],
    primaryAction: (
      <Button variant="contained" size="small">
        <Icon name={IconName.Portal} sx={{ mr: 0.5, fontSize: 18 }} />
        Launch Portal
      </Button>
    ),
    secondaryActions: [
      {
        label: "Edit",
        icon: <Icon name={IconName.Settings} sx={{ fontSize: 20 }} />,
        onClick: () => console.log("Edit clicked"),
      },
      {
        label: "Duplicate",
        icon: <Icon name={IconName.DataObject} sx={{ fontSize: 20 }} />,
        onClick: () => console.log("Duplicate clicked"),
      },
      {
        label: "Delete",
        icon: <Icon name={IconName.Delete} sx={{ fontSize: 20 }} />,
        onClick: () => console.log("Delete clicked"),
        color: "error" as const,
      },
    ],
  },
};

export const WithMetadata: Story = {
  args: {
    title: "Weather Station Alpha",
    icon: <Icon name={IconName.Hub} />,
    breadcrumbs: [
      { label: "Home", href: "/" },
      { label: "Stations", href: "/stations" },
      { label: "Weather Station Alpha" },
    ],
    primaryAction: (
      <Button variant="contained" size="small">
        Launch Portal
      </Button>
    ),
    secondaryActions: [
      {
        label: "Edit",
        onClick: () => console.log("Edit clicked"),
      },
      {
        label: "Delete",
        onClick: () => console.log("Delete clicked"),
        color: "error" as const,
      },
    ],
    children: (
      <>
        <MuiTypography variant="body2" color="text.secondary">
          Monitors weather patterns across the northern region with 12 active
          sensors.
        </MuiTypography>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Chip
            label="Active"
            color="success"
            size="small"
            variant="outlined"
          />
          <Chip label="12 Connectors" size="small" variant="outlined" />
          <Chip label="Weather" size="small" variant="outlined" />
        </Stack>
      </>
    ),
  },
};

export const SecondaryActionsOnly: Story = {
  args: {
    title: "Settings",
    icon: <Icon name={IconName.Settings} />,
    breadcrumbs: [{ label: "Home", href: "/" }, { label: "Settings" }],
    secondaryActions: [
      {
        label: "Export",
        onClick: () => console.log("Export clicked"),
      },
      {
        label: "Import",
        onClick: () => console.log("Import clicked"),
      },
      {
        label: "Reset to Defaults",
        onClick: () => console.log("Reset clicked"),
        color: "error" as const,
        disabled: true,
      },
    ],
  },
};

export const NoBreadcrumbs: Story = {
  args: {
    title: "Dashboard",
    icon: <Icon name={IconName.Home} />,
    primaryAction: (
      <Button variant="contained" size="small">
        New Station
      </Button>
    ),
  },
};

export const LongTitle: Story = {
  args: {
    title:
      "This Is an Extremely Long Page Title That Should Truncate Gracefully When It Runs Out of Space",
    breadcrumbs: [
      { label: "Home", href: "/" },
      { label: "Category", href: "/category" },
      { label: "Very Long Title" },
    ],
    primaryAction: (
      <Button variant="contained" size="small">
        Action
      </Button>
    ),
  },
};

export const MinimalTitleOnly: Story = {
  args: {
    title: "Settings",
  },
};
