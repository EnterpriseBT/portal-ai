import type { Meta, StoryObj } from "@storybook/react";

import { TagResultGroupUI } from "../components/TagResultGroup.component";
import { TAG_GROUPS } from "./dashboard-fixtures";

/** #1123: one type's results on a tag's page. */
const meta = {
  title: "Dashboard/TagResultGroup",
  component: TagResultGroupUI,
  parameters: { layout: "padded" },
  args: TAG_GROUPS[1],
} satisfies Meta<typeof TagResultGroupUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};
export const EmptyGroup: Story = { args: TAG_GROUPS[2] };
