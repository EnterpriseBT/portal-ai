import React from "react";

import { UseQueryResult } from "@tanstack/react-query";
import {
  JobGetResponsePayload,
  JobListRequestQuery,
  JobListResponsePayload,
} from "@portalai/core/contracts";
import {
  Box,
  Card,
  CardContent,
  Divider,
  Stack,
  Typography,
  Button,
  StatusBadge,
  Progress,
} from "@portalai/core/ui";
import type { Job, JobStatus } from "@portalai/core/models";
import { DateFactory } from "@portalai/core/utils";

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
    <Box
      onClick={() =>
        router.navigate({ to: `/jobs/${job.id}` })
      }
      sx={{
        display: "flex",
        flexDirection: { xs: "column", sm: "row" },
        alignItems: { xs: "flex-start", sm: "center" },
        gap: 2,
        p: 2,
        borderRadius: 1,
        cursor: "pointer",
        "&:hover": { bgcolor: "action.hover" },
        border: 1,
        borderColor: "divider",
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0, width: { xs: "100%", sm: "auto" } }}>
        <Typography variant="body1" fontWeight={600} noWrap>
          {job.type}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {formatDate(job.created)}
        </Typography>
      </Box>
      <Box sx={{ width: { xs: "100%", sm: 200 } }}>
        {displayStatus === "active" ? (
          <Progress value={displayProgress} height={6} />
        ) : (
          <StatusBadge status={displayStatus} />
        )}
      </Box>
    </Box>
  );
};

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <>
    <Typography variant="body1">
      <Box component="span" fontWeight={600} color="text.primary">
        {label}:
      </Box>{" "}
      <Box component="span" color="text.secondary">
        {value}
      </Box>
    </Typography>
    <Divider />
  </>
);

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

export const JobDetailContent = ({
  job,
  stream,
  onCancel,
  isCancelling,
}: JobDetailContentProps) => {
  const hasStreamData = stream.status !== null;
  const status = (hasStreamData ? stream.status : job.status)!;
  const progress = hasStreamData ? stream.progress : job.progress;
  const error = hasStreamData ? stream.error : job.error;
  const result = hasStreamData ? stream.result : job.result;
  const startedAt = hasStreamData ? stream.startedAt : job.startedAt;
  const completedAt = hasStreamData ? stream.completedAt : job.completedAt;

  const isTerminal = !["pending", "active"].includes(status);

  return (
    <Stack spacing={3}>
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        gap={2}
      >
        <Box>
          <Typography variant="h1" gutterBottom>
            {job.type}
          </Typography>
          <StatusBadge status={status} />
        </Box>
        {!isTerminal && (
          <Button
            variant="outlined"
            color="error"
            onClick={onCancel}
            disabled={isCancelling}
          >
            Cancel Job
          </Button>
        )}
      </Box>

      {status === "active" && (
        <Progress value={progress} height={10} color="info" />
      )}

      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <DetailRow label="Job ID" value={job.id} />
            <DetailRow label="Type" value={job.type} />
            <DetailRow label="Progress" value={`${Math.round(progress)}%`} />
            <DetailRow label="Created" value={formatDate(job.created)} />
            <DetailRow label="Started" value={formatDate(startedAt)} />
            <DetailRow label="Completed" value={formatDate(completedAt)} />
            <DetailRow label="Attempts" value={`${job.attempts} / ${job.maxAttempts}`} />
          </Stack>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent>
            <Typography variant="h2" color="error.main" gutterBottom>
              Error
            </Typography>
            <Typography
              variant="body2"
              sx={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}
            >
              {error}
            </Typography>
          </CardContent>
        </Card>
      )}

      {result && Object.keys(result).length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="h2" gutterBottom>
              Result
            </Typography>
            <Typography
              variant="body2"
              component="pre"
              sx={{ fontFamily: "monospace", whiteSpace: "pre-wrap", m: 0 }}
            >
              {JSON.stringify(result, null, 2)}
            </Typography>
          </CardContent>
        </Card>
      )}

      {job.metadata && Object.keys(job.metadata).length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="h2" gutterBottom>
              Metadata
            </Typography>
            <Typography
              variant="body2"
              component="pre"
              sx={{ fontFamily: "monospace", whiteSpace: "pre-wrap", m: 0 }}
            >
              {JSON.stringify(job.metadata, null, 2)}
            </Typography>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
};
