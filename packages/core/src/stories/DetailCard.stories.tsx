import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import MuiTypography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";

import { DetailCard } from "../ui/DetailCard";
import { Icon, IconName } from "../ui/Icon";

const meta = {
  title: "Components/DetailCard",
  component: DetailCard,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  argTypes: {
    title: { control: "text", description: "Card title" },
    variant: {
      control: "select",
      options: ["outlined", "elevation"],
      description: "MUI Card variant",
    },
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 720 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof DetailCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Alpha Connector",
  },
};

export const WithIcon: Story = {
  args: {
    title: "Alpha Connector",
    icon: <Icon name={IconName.Link} />,
  },
};

export const WithContent: Story = {
  args: {
    title: "Alpha Connector",
    icon: <Icon name={IconName.Link} />,
    children: (
      <Stack spacing={0.5}>
        <MuiTypography variant="body2" color="text.secondary">
          Last synced 2 hours ago
        </MuiTypography>
        <Stack direction="row" spacing={1}>
          <Chip label="Active" color="success" size="small" variant="outlined" />
          <Chip label="CSV" size="small" variant="outlined" />
        </Stack>
      </Stack>
    ),
  },
};

export const WithActions: Story = {
  args: {
    title: "Alpha Connector",
    icon: <Icon name={IconName.Link} />,
    actions: [
      { label: "Edit", onClick: () => console.log("Edit") },
      { label: "Delete", onClick: () => console.log("Delete"), color: "error" },
    ],
    children: (
      <MuiTypography variant="body2" color="text.secondary">
        Last synced 2 hours ago
      </MuiTypography>
    ),
  },
};

export const Clickable: Story = {
  args: {
    title: "Alpha Connector",
    icon: <Icon name={IconName.Link} />,
    onClick: () => console.log("Card clicked"),
    children: (
      <MuiTypography variant="body2" color="text.secondary">
        Click anywhere on this card to navigate.
      </MuiTypography>
    ),
  },
};

export const ClickableWithActions: Story = {
  args: {
    title: "Alpha Connector",
    icon: <Icon name={IconName.Link} />,
    onClick: () => console.log("Card clicked"),
    actions: [
      { label: "Edit", onClick: () => console.log("Edit") },
      { label: "Delete", onClick: () => console.log("Delete"), color: "error", icon: <Icon name={IconName.Delete} /> },
    ],
    children: (
      <MuiTypography variant="body2" color="text.secondary">
        Card is clickable but action buttons work independently.
      </MuiTypography>
    ),
  },
};

export const LongTitle: Story = {
  args: {
    title:
      "This Is a Very Long Connector Name That Should Truncate When There Is Not Enough Space",
    icon: <Icon name={IconName.Link} />,
    actions: [
      { label: "Edit", onClick: () => console.log("Edit") },
    ],
  },
};

export const StackedList: Story = {
  render: () => (
    <Stack spacing={1}>
      {["Alpha", "Beta", "Gamma", "Delta"].map((name) => (
        <DetailCard
          key={name}
          title={`${name} Connector`}
          icon={<Icon name={IconName.Link} />}
          onClick={() => console.log(`${name} clicked`)}
          actions={[
            { label: "Edit", onClick: () => console.log(`Edit ${name}`) },
            {
              label: "Delete",
              onClick: () => console.log(`Delete ${name}`),
              color: "error",
            },
          ]}
        >
          <MuiTypography variant="body2" color="text.secondary">
            Last synced {Math.floor(Math.random() * 24) + 1} hours ago
          </MuiTypography>
        </DetailCard>
      ))}
    </Stack>
  ),
  args: {
    title: "unused",
  },
};

export const NoContent: Story = {
  args: {
    title: "Empty Connector",
    icon: <Icon name={IconName.Link} />,
    actions: [
      { label: "Configure", onClick: () => console.log("Configure"), variant: "contained" },
    ],
  },
};
