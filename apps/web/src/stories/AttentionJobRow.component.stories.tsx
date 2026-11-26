import type { Meta, StoryObj } from "@storybook/react";

import { AttentionJobRowUI } from "../components/AttentionJobRow.component";
import { ATTENTION_JOBS } from "./dashboard-fixtures";

/** #1123: one job in Needs attention. */
const meta = {
  title: "Dashboard/AttentionJobRow",
  component: AttentionJobRowUI,
  parameters: { layout: "padded" },
  args: { job: ATTENTION_JOBS[0] },
} satisfies Meta<typeof AttentionJobRowUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Failed: Story = {};
export const NeedsConfirmation: Story = { args: { job: ATTENTION_JOBS[1] } };
export const Stalled: Story = { args: { job: ATTENTION_JOBS[2] } };
export const NoLocation: Story = {
  args: { job: { ...ATTENTION_JOBS[0], where: null } },
};
