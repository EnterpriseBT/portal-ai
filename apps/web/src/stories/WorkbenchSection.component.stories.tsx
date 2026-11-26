import type { Meta, StoryObj } from "@storybook/react";

import { Icon, IconName, Typography } from "@portalai/core/ui";

import { WorkbenchSectionUI } from "../components/WorkbenchSection.component";

/** #1123: one dashboard workbench section, with and without "see all". */
const meta = {
  title: "Dashboard/WorkbenchSection",
  component: WorkbenchSectionUI,
  parameters: { layout: "padded" },
  args: {
    title: "Favorite stations",
    icon: <Icon name={IconName.Star} />,
    children: (
      <Typography variant="body2" color="text.secondary">
        Section content
      </Typography>
    ),
  },
} satisfies Meta<typeof WorkbenchSectionUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithSeeAll: Story = {
  args: { seeAll: { href: "/stations", label: "All stations" } },
};
export const WithoutSeeAll: Story = {
  args: { title: "Recent portals", icon: <Icon name={IconName.Portal} /> },
};
