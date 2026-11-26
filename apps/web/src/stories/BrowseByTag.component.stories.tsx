import type { Meta, StoryObj } from "@storybook/react";

import { BrowseByTagUI } from "../components/BrowseByTag.component";
import { TAG_COUNTS } from "./dashboard-fixtures";

/** #1123: the dashboard's Browse by tag. */
const meta = {
  title: "Dashboard/BrowseByTag",
  component: BrowseByTagUI,
  parameters: { layout: "padded" },
  args: { tags: TAG_COUNTS },
} satisfies Meta<typeof BrowseByTagUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};
export const Empty: Story = { args: { tags: [] } };
