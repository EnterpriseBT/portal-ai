import React from "react";

import { UseQueryResult } from "@tanstack/react-query";
import {
  JobGetResponsePayload,
  JobListRequestQuery,
  JobListResponsePayload,
} from "@portalai/core/contracts";
import {
  Box,
  DetailCard,
  Stack,
  Typography,
  StatusBadge,
  Progress,
} from "@portalai/core/ui";
import { JobModel } from "@portalai/core/models";
import type { Job, JobProgressDetail, JobStatus } from "@portalai/core/models";
import { DateFactory } from "@portalai/core/utils";
import { formatJobProgress } from "../utils/job-progress.util";
import { runningJobLabel } from "../utils/running-job-label.util";
import type { JobStreamState } from "../api/jobs.api";
import { sdk } from "../api/sdk";
import { ApiError } from "../utils";
import { RouterLink } from "./RouterLink.component";

const dates = new DateFactory("UTC");

export interface JobDataListProps {
  query: JobListRequestQuery;
  children: (
    data: UseQueryResult<JobListResponsePayload, ApiError>
  ) => React.ReactNode;
}

export const JobDataList = (props: JobDataListProps) => {
  const res = sdk.jobs.list(props.query);
  return props.children(res);
};

export interface JobDataItemProps {
  id: string;
  children: (
    data: UseQueryResult<JobGetResponsePayload, ApiError>
  ) => React.ReactNode;
}

export const JobDataItem = (props: JobDataItemProps) => {
  const res = sdk.jobs.get(props.id);
  return props.children(res);
};

export interface JobDataStreamProps {
  job: Job;
  children: (stream: JobStreamState) => React.ReactNode;
}

export const JobDataStream = ({ job, children }: JobDataStreamProps) => {
  const isLive = !JobModel.isTerminalStatus(job.status);
  const stream = sdk.jobs.stream(isLive ? job.id : null);
  return <>{children(stream)}</>;
};

const formatDate = (timestamp: number | null) =>
  timestamp ? dates.format(timestamp, "MM/dd/yyyy hh:mm:ss a") : "—";

export interface JobCardProps {
  job: Job;
  status?: JobStatus;
  progress?: number;
  /** Live structured progress from a stream; falls back to the row's (#458). */
  progressDetail?: JobProgressDetail | null;
  /** The title's heading level (#794): 2 directly under a page's h1. Default 3. */
  headingLevel?: 2 | 3;
}

export const JobCard = ({
  job,
  status,
  progress,
  progressDetail,
  headingLevel,
}: JobCardProps) => {
  const displayStatus = status ?? job.status;
  const displayProgress = progress ?? job.progress;
  const displayDetail = progressDetail ?? job.progressDetail;
  const display = formatJobProgress(displayDetail, displayProgress);

  return (
    <DetailCard
      title={runningJobLabel(job)}
      // #794: the card opens its job through its title's link.
      href={`/jobs/${job.id}`}
      linkComponent={RouterLink}
      headingLevel={headingLevel}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
        spacing={1}
      >
        <Typography variant="body2" color="text.secondary">
          {formatDate(job.created)}
        </Typography>
        <Box sx={{ width: { xs: "100%", sm: 200 } }}>
          {displayStatus === "active" ? (
            <Progress
              value={display.kind === "count" ? 0 : display.barValue}
              indeterminate={display.kind === "count"}
              showLabel={display.kind !== "count"}
              height={6}
              animated
            />
          ) : (
            <StatusBadge status={displayStatus} />
          )}
        </Box>
      </Stack>
    </DetailCard>
  );
};

export interface JobDetailContentStream {
  status: JobStatus | null;
  progress: number;
  error: string | null;
  result: Record<string, unknown> | null;
  startedAt: number | null;
  completedAt: number | null;
}

export interface JobDetailContentProps {
  job: Job;
  stream: JobDetailContentStream;
  onCancel: () => void;
  isCancelling: boolean;
}
