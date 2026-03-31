import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Icon,
  IconName,
  PageHeader,
  Progress,
  Stack,
  StatusBadge,
  Typography,
} from "@portalai/core/ui";
import CancelIcon from "@mui/icons-material/Cancel";
import { JobModel } from "@portalai/core/models";
import { DateFactory } from "@portalai/core/utils";
import { useNavigate } from "@tanstack/react-router";

import { JobDataStream } from "../components/Job.component";
import DataResult from "../components/DataResult.component";
import { JobDataItem } from "../components/Job.component";
import { sdk } from "../api/sdk";

const dates = new DateFactory("UTC");

const formatDate = (timestamp: number | null) =>
  timestamp ? dates.format(timestamp, "MM/dd/yyyy hh:mm:ss a") : "—";

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
  const navigate = useNavigate();
  const { mutate: cancel, isPending: isCancelling } = sdk.jobs.cancel(jobId);

  return (
    <JobDataItem id={jobId}>
      {(response) => (
        <DataResult results={{ jobResponse: response }}>
          {({ jobResponse }) => (
            <JobDataStream job={jobResponse.job}>
              {(stream) => {
                const job = jobResponse.job;
                const hasStreamData = stream.status !== null;
                const status = (hasStreamData ? stream.status : job.status)!;
                const progress = hasStreamData ? stream.progress : job.progress;
                const error = hasStreamData ? stream.error : job.error;
                const result = hasStreamData ? stream.result : job.result;
                const startedAt = hasStreamData ? stream.startedAt : job.startedAt;
                const completedAt = hasStreamData ? stream.completedAt : job.completedAt;
                const isTerminal = JobModel.isTerminalStatus(status);

                return (
                  <Stack spacing={3}>
                    <PageHeader
                      breadcrumbs={[
                        { label: "Dashboard", href: "/" },
                        { label: "Jobs", href: "/jobs" },
                        { label: job.type },
                      ]}
                      onNavigate={(href) => navigate({ to: href })}
                      title={job.type}
                      icon={<Icon name={IconName.Work} />}
                      primaryAction={
                        !isTerminal ? (
                          <Button
                            variant="contained"
                            color="error"
                            startIcon={<CancelIcon />}
                            onClick={() => cancel()}
                            disabled={isCancelling}
                          >
                            Cancel Job
                          </Button>
                        ) : undefined
                      }
                    >
                      <Box>
                        <StatusBadge status={status} />
                      </Box>
                    </PageHeader>

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
                          <DetailRow
                            label="Attempts"
                            value={`${job.attempts} / ${job.maxAttempts}`}
                          />
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
              }}
            </JobDataStream>
          )}
        </DataResult>
      )}
    </JobDataItem>
  );
};
