import type { Meta, StoryObj } from "@storybook/react";

import { NeedsAttentionUI } from "../components/NeedsAttention.component";
import { ATTENTION_JOBS } from "./dashboard-fixtures";

/** #1123: the dashboard's Needs attention. */
const meta = {
  title: "Dashboard/NeedsAttention",
  component: NeedsAttentionUI,
  parameters: { layout: "padded" },
  args: { jobs: ATTENTION_JOBS },
} satisfies Meta<typeof NeedsAttentionUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};
export const AllClear: Story = { args: { jobs: [] } };
