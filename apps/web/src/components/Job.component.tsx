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
import type { Job, JobStatus } from "@portalai/core/models";
import { DateFactory } from "@portalai/core/utils";
import type { JobStreamState } from "../api/jobs.api";
import { sdk } from "../api/sdk";
import { ApiError } from "../utils";
import { useRouter } from "@tanstack/react-router";

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
}

export const JobCard = ({ job, status, progress }: JobCardProps) => {
  const router = useRouter();

  const displayStatus = status ?? job.status;
  const displayProgress = progress ?? job.progress;

  return (
    <DetailCard
      title={job.type}
      onClick={() => router.navigate({ to: `/jobs/${job.id}` })}
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
            <Progress value={displayProgress} height={6} />
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
