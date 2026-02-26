import type { Meta, StoryObj } from "@storybook/react";
import { IconName, Typography, Box } from "@mcp-ui/core/ui";
import { SidebarNavUI } from "../components/SidebarNav.component";
import { SidebarNavItemUI } from "../components/SidebarNavItem.component";

const sampleChildren = (
  <>
    <SidebarNavItemUI
      icon={IconName.Home}
      label="Dashboard"
      collapsed={false}
    />
    <SidebarNavItemUI
      icon={IconName.Settings}
      label="Settings"
      collapsed={false}
    />
    <SidebarNavItemUI
      icon={IconName.Person}
      label="Users"
      collapsed={false}
      items={[{ label: "All Users" }, { label: "Admins", selected: true }]}
      open={true}
    />
  </>
);

const collapsedChildren = (
  <>
    <SidebarNavItemUI icon={IconName.Home} label="Dashboard" collapsed={true} />
    <SidebarNavItemUI
      icon={IconName.Settings}
      label="Settings"
      collapsed={true}
    />
    <SidebarNavItemUI icon={IconName.Person} label="Users" collapsed={true} />
  </>
);

const sampleFooter = (
  <Box sx={{ p: 1, textAlign: "center" }}>
    <Typography variant="caption">v1.0.0</Typography>
  </Box>
);

const meta = {
  title: "Components/SidebarNavUI",
  component: SidebarNavUI,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Box sx={{ display: "flex", height: 400 }}>
        <Story />
        <Box sx={{ flex: 1, p: 2 }}>
          <Typography>Page content</Typography>
        </Box>
      </Box>
    ),
  ],
} satisfies Meta<typeof SidebarNavUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {
  args: {
    collapsed: false,
    hidden: false,
    children: sampleChildren,
    footer: sampleFooter,
  },
};

export const Collapsed: Story = {
  args: {
    collapsed: true,
    hidden: false,
    children: collapsedChildren,
    footer: sampleFooter,
  },
};

export const Hidden: Story = {
  args: {
    collapsed: true,
    hidden: true,
    children: collapsedChildren,
  },
};

export const WithoutFooter: Story = {
  args: {
    collapsed: false,
    hidden: false,
    children: sampleChildren,
  },
};

export const FooterRenderProp: Story = {
  args: {
    collapsed: false,
    hidden: false,
    children: sampleChildren,
    footer: () => (
      <SidebarNavItemUI
        icon={IconName.Logout}
        label="Logout"
        collapsed={false}
      />
    ),
  },
};
