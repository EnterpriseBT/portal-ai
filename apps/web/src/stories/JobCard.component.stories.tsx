import type { Meta, StoryObj } from "@storybook/react";
import type { Job } from "@portalai/core/models";

import { JobCard } from "../components/Job.component";

const baseJob: Job = {
  id: "job-abc-123",
  organizationId: "org-1",
  type: "system_check",
  status: "pending",
  progress: 0,
  metadata: {},
  result: null,
  error: null,
  startedAt: null,
  completedAt: null,
  bullJobId: "bull-1",
  attempts: 0,
  maxAttempts: 3,
  created: 1710000000000,
  createdBy: "user-1",
  updated: 1710000000000,
  updatedBy: "user-1",
  deleted: null,
  deletedBy: null,
};

const meta = {
  title: "Components/JobCard",
  component: JobCard,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  argTypes: {
    status: {
      control: "select",
      options: [
        undefined,
        "pending",
        "active",
        "completed",
        "failed",
        "stalled",
        "cancelled",
      ],
      description:
        "Stream-overridden status (overrides job.status when provided)",
    },
    progress: {
      control: { type: "range", min: 0, max: 100 },
      description:
        "Stream-overridden progress (overrides job.progress when provided)",
    },
  },
} satisfies Meta<typeof JobCard>;

export default meta;
type Story = StoryObj<typeof JobCard>;

export const Pending: Story = {
  args: {
    job: { ...baseJob, status: "pending" },
  },
};

export const Active: Story = {
  args: {
    job: {
      ...baseJob,
      status: "active",
      progress: 45,
      startedAt: 1710000000000,
    },
  },
};

export const ActiveWithStreamProgress: Story = {
  args: {
    job: {
      ...baseJob,
      status: "active",
      progress: 20,
      startedAt: 1710000000000,
    },
    status: "active",
    progress: 72,
  },
};

export const Completed: Story = {
  args: {
    job: {
      ...baseJob,
      status: "completed",
      progress: 100,
      startedAt: 1710000000000,
      completedAt: 1710000060000,
    },
  },
};

export const Failed: Story = {
  args: {
    job: {
      ...baseJob,
      status: "failed",
      progress: 33,
      error: "Connection timed out",
      startedAt: 1710000000000,
      completedAt: 1710000030000,
    },
  },
};

export const Cancelled: Story = {
  args: {
    job: {
      ...baseJob,
      status: "cancelled",
      progress: 50,
      startedAt: 1710000000000,
      completedAt: 1710000045000,
    },
  },
};

export const Stalled: Story = {
  args: {
    job: {
      ...baseJob,
      status: "stalled",
      progress: 60,
      startedAt: 1710000000000,
    },
  },
};

export const Revalidation: Story = {
  args: {
    job: {
      ...baseJob,
      type: "revalidation",
      status: "active",
      progress: 88,
      startedAt: 1710000000000,
    },
  },
};

export const StreamOverrideCompleted: Story = {
  args: {
    job: {
      ...baseJob,
      status: "active",
      progress: 80,
      startedAt: 1710000000000,
    },
    status: "completed",
    progress: 100,
  },
};
