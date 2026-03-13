import {
  Box,
  Card,
  CardContent,
  Divider,
  Stack,
  Typography,
  Button,
  Progress,
  StatusBadge,
} from "@mcp-ui/core/ui";
import { TERMINAL_JOB_STATUSES } from "@mcp-ui/core/models";
import type { Job } from "@mcp-ui/core/models";

import { DataResult } from "../components/DataResult.component";
import { sdk } from "../api/sdk";
import { useJobStream } from "../utils/job-stream.util";

const formatDate = (timestamp: number | null) =>
  timestamp ? new Date(timestamp).toLocaleString() : "—";

interface JobDetailContentProps {
  job: Job;
}

const JobDetailContent = ({ job }: JobDetailContentProps) => {
  const stream = useJobStream(
    TERMINAL_JOB_STATUSES.includes(job.status) ? null : job.id
  );

  const hasStreamData = stream.status !== null;
  const status = (hasStreamData ? stream.status : job.status)!;
  const progress = hasStreamData ? stream.progress : job.progress;
  const error = hasStreamData ? stream.error : job.error;
  const result = hasStreamData ? stream.result : job.result;
  const startedAt = hasStreamData ? stream.startedAt : job.startedAt;
  const completedAt = hasStreamData ? stream.completedAt : job.completedAt;

  const isTerminal = TERMINAL_JOB_STATUSES.includes(status);
  const { mutate: cancel, isPending: isCancelling } = sdk.jobs.cancel(job.id);

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
            onClick={() => cancel()}
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

interface JobDetailViewProps {
  jobId: string;
}

export const JobDetailView = ({ jobId }: JobDetailViewProps) => {
  const jobResult = sdk.jobs.get(jobId);

  return (
    <DataResult results={{ jobResult }}>
      {({ jobResult: data }) => <JobDetailContent job={data.job} />}
    </DataResult>
  );
};
