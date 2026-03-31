import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import MuiTypography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";

import { PageSection } from "../ui/PageSection";
import { Button } from "../ui/Button";
import { Icon, IconName } from "../ui/Icon";

const meta = {
  title: "Components/PageSection",
  component: PageSection,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  argTypes: {
    title: {
      control: "text",
      description: "Section title displayed as h2",
    },
    variant: {
      control: "select",
      options: ["default", "outlined"],
      description: "Visual variant",
    },
    spacing: {
      control: "number",
      description: "Spacing between header and body",
    },
    padding: {
      control: "number",
      description: "Padding inside the section (outlined variant)",
    },
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 960 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof PageSection>;

export default meta;
type Story = StoryObj<typeof meta>;

const SampleCards = () => (
  <Stack spacing={1}>
    {["Alpha Connector", "Beta Connector", "Gamma Connector"].map((name) => (
      <Card key={name} variant="outlined">
        <CardContent>
          <MuiTypography variant="subtitle1">{name}</MuiTypography>
          <MuiTypography variant="body2" color="text.secondary">
            Last synced 2 hours ago
          </MuiTypography>
        </CardContent>
      </Card>
    ))}
  </Stack>
);

export const Default: Story = {
  args: {
    title: "Connectors",
    children: <SampleCards />,
  },
};

export const WithIcon: Story = {
  args: {
    title: "Connectors",
    icon: <Icon name={IconName.Link} />,
    children: <SampleCards />,
  },
};

export const WithActions: Story = {
  args: {
    title: "Connectors",
    icon: <Icon name={IconName.Link} />,
    primaryAction: (
      <Button variant="contained" size="small">
        Add Connector
      </Button>
    ),
    secondaryActions: [
      {
        label: "Manage",
        onClick: () => console.log("Manage clicked"),
      },
      {
        label: "Export All",
        onClick: () => console.log("Export clicked"),
      },
    ],
    children: <SampleCards />,
  },
};

export const OutlinedVariant: Story = {
  args: {
    title: "Recent Jobs",
    icon: <Icon name={IconName.Work} />,
    variant: "outlined",
    primaryAction: (
      <Button variant="outlined" size="small">
        View All
      </Button>
    ),
    children: <SampleCards />,
  },
};

export const OutlinedWithCustomPadding: Story = {
  args: {
    title: "Configuration",
    icon: <Icon name={IconName.Settings} />,
    variant: "outlined",
    padding: 4,
    children: (
      <MuiTypography variant="body2" color="text.secondary">
        Section body with extra padding inside the outlined container.
      </MuiTypography>
    ),
  },
};

export const NoTitle: Story = {
  args: {
    children: (
      <MuiTypography variant="body1">
        A section without a title renders just the body content — useful as a
        pure layout container.
      </MuiTypography>
    ),
  },
};

export const ActionsOnly: Story = {
  args: {
    primaryAction: (
      <Button variant="contained" size="small">
        Create
      </Button>
    ),
    children: <SampleCards />,
  },
};

export const WithSecondaryMenu: Story = {
  args: {
    title: "Entity Groups",
    icon: <Icon name={IconName.DataObject} />,
    variant: "outlined",
    secondaryActions: [
      {
        label: "Sort by Name",
        onClick: () => console.log("Sort clicked"),
      },
      {
        label: "Filter Active",
        onClick: () => console.log("Filter clicked"),
      },
      {
        label: "Remove All",
        onClick: () => console.log("Remove clicked"),
        color: "error" as const,
      },
    ],
    children: <SampleCards />,
  },
};

export const Composed: Story = {
  args: {
    title: "Active Connectors",
    children: <SampleCards />,
  },
  render: () => (
    <Stack spacing={4}>
      <PageSection
        title="Active Connectors"
        icon={<Icon name={IconName.Link} />}
        primaryAction={
          <Button variant="contained" size="small">
            Add
          </Button>
        }
        secondaryActions={[
          {
            label: "Export",
            onClick: () => console.log("Export clicked"),
          },
          {
            label: "Refresh",
            onClick: () => console.log("Refresh clicked"),
          },
        ]}
      >
        <SampleCards />
      </PageSection>

      <PageSection
        title="Job History"
        icon={<Icon name={IconName.Work} />}
        variant="outlined"
        primaryAction={
          <Button variant="outlined" size="small">
            View All
          </Button>
        }
      >
        <SampleCards />
      </PageSection>
    </Stack>
  ),
};
