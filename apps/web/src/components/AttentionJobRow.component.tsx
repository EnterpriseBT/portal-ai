import React from "react";

import Chip from "@mui/material/Chip";

import {
  JOB_TYPE_LABELS,
  type JobStatus,
  type JobType,
} from "@portalai/core/models";
import { DetailCard, Stack, Typography } from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";

import { RouterLink } from "./RouterLink.component";

/** A job that needs the caller's attention. */
export interface AttentionJob {
  id: string;
  type: JobType;
  status: JobStatus;
  /** What it ran on: a connector or entity name. */
  where: string | null;
  /** When it last changed (epoch ms). */
  updated: number;
}

const STATUS_LABELS: Record<JobStatus, string> = {
  pending: "Pending",
  active: "Running",
  completed: "Completed",
  failed: "Failed",
  stalled: "Stalled",
  cancelled: "Cancelled",
  awaiting_confirmation: "Needs confirmation",
};

const STATUS_COLORS: Partial<Record<JobStatus, "error" | "warning" | "info">> =
  {
    failed: "error",
    stalled: "warning",
    awaiting_confirmation: "info",
  };

export interface AttentionJobRowUIProps {
  job: AttentionJob;
}

/**
 * One job in Needs attention (#1123). It's named the way lock alerts name
 * it (core's `JOB_TYPE_LABELS`) plus where it ran, so rows stay distinct,
 * and links to the job's page.
 */
export const AttentionJobRowUI: React.FC<AttentionJobRowUIProps> = ({
  job,
}) => {
  const label = JOB_TYPE_LABELS[job.type] ?? job.type;
  return (
    <DetailCard
      title={job.where ? `${label} on ${job.where}` : label}
      href={`/jobs/${job.id}`}
      linkComponent={RouterLink}
      headingLevel={3}
      data-testid={`attention-job-${job.id}`}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <Chip
          size="small"
          label={STATUS_LABELS[job.status]}
          color={STATUS_COLORS[job.status] ?? "default"}
        />
        <Typography variant="caption" color="text.secondary">
          {DateFactory.relativeTime(job.updated)}
        </Typography>
      </Stack>
    </DetailCard>
  );
};
