import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";

import { MetadataList } from "../ui/MetadataList";

const meta = {
  title: "Components/MetadataList",
  component: MetadataList,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  argTypes: {
    layout: {
      control: "select",
      options: ["responsive", "inline", "stacked"],
    },
    size: {
      control: "select",
      options: ["small", "medium"],
    },
    dividers: { control: "boolean" },
    spacing: { control: "number" },
    labelWidth: { control: "number" },
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 640 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof MetadataList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Responsive: Story = {
  args: {
    items: [
      { label: "ID", value: "usr_abc123def456", variant: "mono" },
      { label: "Name", value: "Acme Corporation" },
      { label: "Status", value: "Active", variant: "chip" },
      { label: "Created", value: "March 15, 2026" },
      { label: "Last Sync", value: "2 hours ago" },
    ],
  },
};

export const Inline: Story = {
  args: {
    layout: "inline",
    items: [
      { label: "Key", value: "customer_email", variant: "mono" },
      { label: "Type", value: "String", variant: "chip" },
      { label: "Format", value: "email" },
      { label: "Description", value: "Primary email address for the customer" },
      { label: "Created", value: "Jan 10, 2026" },
    ],
  },
};

export const InlineWithDividers: Story = {
  args: {
    layout: "inline",
    dividers: true,
    size: "medium",
    items: [
      { label: "Job ID", value: "job_98f2a1b3", variant: "mono" },
      { label: "Type", value: "full_sync" },
      { label: "Progress", value: "73%" },
      { label: "Created", value: "March 30, 2026 10:15 AM" },
      { label: "Started", value: "March 30, 2026 10:16 AM" },
      { label: "Attempts", value: "1 / 3" },
    ],
  },
};

export const Stacked: Story = {
  args: {
    layout: "stacked",
    items: [
      { label: "Source ID", value: "ext_9f8e7d6c", variant: "mono" },
      { label: "Checksum", value: "a1b2c3d4e5f6", variant: "mono" },
      { label: "Synced At", value: "March 28, 2026 3:45 PM" },
      { label: "Created", value: "March 1, 2026" },
    ],
  },
};

export const WithCustomValues: Story = {
  args: {
    items: [
      { label: "ID", value: "rec_xyz789", variant: "mono" },
      { label: "Status", value: <Chip label="Active" size="small" color="success" /> },
      {
        label: "Tags",
        value: (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
            <Chip label="production" size="small" variant="outlined" />
            <Chip label="v2" size="small" variant="outlined" />
            <Chip label="validated" size="small" variant="outlined" />
          </Stack>
        ),
      },
      {
        label: "Related",
        value: (
          <Stack direction="row" spacing={1}>
            <Link component="button" variant="body2">
              Group Alpha
            </Link>
            <Link component="button" variant="body2">
              Group Beta
            </Link>
          </Stack>
        ),
      },
    ],
  },
};

export const WithHiddenItems: Story = {
  args: {
    layout: "inline",
    items: [
      { label: "Key", value: "user_name", variant: "mono" },
      { label: "Description", value: "", hidden: true },
      { label: "Format", value: null, hidden: true },
      { label: "Default Value", value: "N/A" },
      { label: "Created", value: "Feb 20, 2026" },
    ],
  },
};

export const MediumSize: Story = {
  args: {
    size: "medium",
    items: [
      { label: "Connector", value: "Salesforce CRM" },
      { label: "Access Mode", value: "Read/Write" },
      { label: "Records", value: "12,345" },
      { label: "Last Sync", value: "March 29, 2026 8:00 PM" },
    ],
  },
};

export const WiderLabels: Story = {
  args: {
    labelWidth: 200,
    items: [
      { label: "Connection String", value: "postgresql://...", variant: "mono" },
      { label: "Max Connections", value: "25" },
      { label: "Connection Timeout", value: "30s" },
      { label: "SSL Mode", value: "require", variant: "chip" },
    ],
  },
};
