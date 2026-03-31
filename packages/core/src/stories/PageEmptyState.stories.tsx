import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Box from "@mui/material/Box";

import { PageEmptyState } from "../ui/PageEmptyState";
import { Button } from "../ui/Button";
import { Icon, IconName } from "../ui/Icon";

const meta = {
  title: "Components/PageEmptyState",
  component: PageEmptyState,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  argTypes: {
    title: {
      control: "text",
      description: "Primary message",
    },
    description: {
      control: "text",
      description: "Secondary description",
    },
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 960 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof PageEmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "No stations found",
  },
};

export const WithIcon: Story = {
  args: {
    icon: <Icon name={IconName.Hub} sx={{ fontSize: "inherit" }} />,
    title: "No stations found",
  },
};

export const WithDescription: Story = {
  args: {
    icon: <Icon name={IconName.Hub} sx={{ fontSize: "inherit" }} />,
    title: "No stations found",
    description:
      "Stations collect and organize data from your connectors. Create your first station to get started.",
  },
};

export const WithAction: Story = {
  args: {
    icon: <Icon name={IconName.Hub} sx={{ fontSize: "inherit" }} />,
    title: "No stations found",
    description:
      "Stations collect and organize data from your connectors. Create your first station to get started.",
    action: (
      <Button variant="contained" size="small">
        Create Station
      </Button>
    ),
  },
};

export const NoResults: Story = {
  args: {
    icon: <Icon name={IconName.Search} sx={{ fontSize: "inherit" }} />,
    title: "No results match your search",
    description: "Try adjusting your filters or search terms.",
  },
};

export const ErrorState: Story = {
  args: {
    icon: <Icon name={IconName.Warning} sx={{ fontSize: "inherit" }} />,
    title: "Something went wrong",
    description: "We couldn't load the data. Please try again later.",
    action: (
      <Button variant="outlined" size="small">
        Retry
      </Button>
    ),
  },
};

export const ConnectorsEmpty: Story = {
  args: {
    icon: <Icon name={IconName.Link} sx={{ fontSize: "inherit" }} />,
    title: "No connectors configured",
    description:
      "Connect a data source to start importing records into this station.",
    action: (
      <Button variant="contained" size="small">
        Add Connector
      </Button>
    ),
  },
};

export const MinimalTitleOnly: Story = {
  args: {
    title: "Nothing here yet",
  },
};
