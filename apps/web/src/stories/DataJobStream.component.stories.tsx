import type { Meta, StoryObj } from "@storybook/react";
import type { Job } from "@mcp-ui/core/models";

import { DataJobStream, DataJobStreamProps } from "../components/DataJobStream.component";
import { JobCard } from "../components/Job.component";

const baseJob: Job = {
  id: "job-abc-123",
  organizationId: "org-1",
  type: "system_check",
  status: "completed",
  progress: 100,
  metadata: {},
  result: null,
  error: null,
  startedAt: 1710000000000,
  completedAt: 1710000060000,
  bullJobId: "bull-1",
  attempts: 1,
  maxAttempts: 3,
  created: 1710000000000,
  createdBy: "user-1",
  updated: 1710000060000,
  updatedBy: "user-1",
  deleted: null,
  deletedBy: null,
};

const meta = {
  title: "Components/DataJobStream",
  component: DataJobStream,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof DataJobStream>;

export default meta;
type Story = StoryObj<DataJobStreamProps>;

export const TerminalJob: Story = {
  args: {
    job: baseJob,
    children: (stream) => (
      <JobCard
        job={baseJob}
        status={stream.status ?? undefined}
        progress={stream.status !== null ? stream.progress : undefined}
      />
    ),
  },
};

export const ActiveJob: Story = {
  args: {
    job: { ...baseJob, status: "active", progress: 45, completedAt: null },
    children: (stream) => (
      <JobCard
        job={{ ...baseJob, status: "active", progress: 45, completedAt: null }}
        status={stream.status ?? undefined}
        progress={stream.status !== null ? stream.progress : undefined}
      />
    ),
  },
};
