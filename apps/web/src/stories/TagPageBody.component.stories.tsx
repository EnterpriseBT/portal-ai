import type { Meta, StoryObj } from "@storybook/react";

import { TagPageBodyUI } from "../components/TagPageBody.component";
import { TAG_GROUPS } from "./dashboard-fixtures";

/** #1123: the body of a tag's page, grouped by type. */
const meta = {
  title: "Dashboard/TagPageBody",
  component: TagPageBodyUI,
  parameters: { layout: "padded" },
  args: { groups: TAG_GROUPS },
} satisfies Meta<typeof TagPageBodyUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};
/** Nothing carries the tag. */
export const Empty: Story = {
  args: {
    groups: TAG_GROUPS.map((group) => ({ ...group, items: [], total: 0 })),
  },
};
