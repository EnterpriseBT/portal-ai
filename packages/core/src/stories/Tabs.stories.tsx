import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Tabs, Tab, TabPanel } from "../ui/Tabs";

const meta = {
  title: "Components/Tabs",
  component: Tabs,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["standard", "scrollable", "fullWidth"],
      description: "The variant of the tabs",
    },
    orientation: {
      control: "select",
      options: ["horizontal", "vertical"],
      description: "The orientation of the tabs",
    },
    textColor: {
      control: "select",
      options: ["primary", "secondary", "inherit"],
      description: "The text color of the tabs",
    },
    indicatorColor: {
      control: "select",
      options: ["primary", "secondary"],
      description: "The indicator color of the tabs",
    },
    centered: {
      control: "boolean",
      description: "Whether the tabs are centered",
    },
  },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

const TabsWithPanels = (args: React.ComponentProps<typeof Tabs>) => {
  const [value, setValue] = React.useState(0);
  return (
    <div style={{ width: 400 }}>
      <Tabs {...args} value={value} onChange={(_, v) => setValue(v)}>
        <Tab label="Tab One" />
        <Tab label="Tab Two" />
        <Tab label="Tab Three" />
      </Tabs>
      <TabPanel value={value} index={0}>
        Content for Tab One
      </TabPanel>
      <TabPanel value={value} index={1}>
        Content for Tab Two
      </TabPanel>
      <TabPanel value={value} index={2}>
        Content for Tab Three
      </TabPanel>
    </div>
  );
};

export const Default: Story = {
  render: (args) => <TabsWithPanels {...args} />,
  args: {
    variant: "standard",
    orientation: "horizontal",
  },
};

export const Centered: Story = {
  render: (args) => <TabsWithPanels {...args} />,
  args: {
    variant: "standard",
    centered: true,
  },
};

export const FullWidth: Story = {
  render: (args) => <TabsWithPanels {...args} />,
  args: {
    variant: "fullWidth",
  },
};

const VerticalTabsWithPanels = (args: React.ComponentProps<typeof Tabs>) => {
  const [value, setValue] = React.useState(0);
  return (
    <div style={{ display: "flex", width: 400 }}>
      <Tabs {...args} value={value} onChange={(_, v) => setValue(v)}>
        <Tab label="Tab One" />
        <Tab label="Tab Two" />
        <Tab label="Tab Three" />
      </Tabs>
      <div style={{ flex: 1 }}>
        <TabPanel value={value} index={0}>
          Content for Tab One
        </TabPanel>
        <TabPanel value={value} index={1}>
          Content for Tab Two
        </TabPanel>
        <TabPanel value={value} index={2}>
          Content for Tab Three
        </TabPanel>
      </div>
    </div>
  );
};

export const Vertical: Story = {
  render: (args) => <VerticalTabsWithPanels {...args} />,
  args: {
    orientation: "vertical",
    variant: "standard",
  },
};
