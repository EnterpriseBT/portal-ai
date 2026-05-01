import {
  Box,
  Button,
  Icon,
  IconName,
  MetadataList,
  PageHeader,
  PageSection,
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
                const startedAt = hasStreamData
                  ? stream.startedAt
                  : job.startedAt;
                const completedAt = hasStreamData
                  ? stream.completedAt
                  : job.completedAt;
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
                      <MetadataList
                        direction="vertical"
                        layout="responsive"
                        items={[
                          {
                            label: "Status",
                            value: <Box>
                              <StatusBadge status={status} />
                            </Box>
                          },
                          { label: "Job ID", value: job.id, variant: "mono" },
                          { label: "Type", value: job.type },
                          {
                            label: "Progress",
                            value: `${Math.round(progress)}%`,
                          },
                          { label: "Created", value: formatDate(job.created) },
                          { label: "Started", value: formatDate(startedAt) },
                          {
                            label: "Completed",
                            value: formatDate(completedAt),
                          },
                          {
                            label: "Attempts",
                            value: `${job.attempts} / ${job.maxAttempts}`,
                          },
                        ]}
                      />
                    </PageHeader>

                    {status === "active" && (
                      <Progress
                        value={progress}
                        height={10}
                        color="info"
                        animated
                      />
                    )}

                    {error && (
                      <PageSection
                        title="Error"
                        icon={<Icon name={IconName.Error} />}
                        variant="outlined"
                      >
                        <Typography
                          variant="body2"
                          color="error.main"
                          sx={{
                            fontFamily: "monospace",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {error}
                        </Typography>
                      </PageSection>
                    )}

                    {result && Object.keys(result).length > 0 && (
                      <PageSection title="Result" variant="outlined">
                        <Typography
                          variant="body2"
                          component="pre"
                          sx={{
                            fontFamily: "monospace",
                            whiteSpace: "pre-wrap",
                            m: 0,
                          }}
                        >
                          {JSON.stringify(result, null, 2)}
                        </Typography>
                      </PageSection>
                    )}

                    {job.metadata && Object.keys(job.metadata).length > 0 && (
                      <PageSection title="Metadata" variant="outlined">
                        <Typography
                          variant="body2"
                          component="pre"
                          sx={{
                            fontFamily: "monospace",
                            whiteSpace: "pre-wrap",
                            m: 0,
                          }}
                        >
                          {JSON.stringify(job.metadata, null, 2)}
                        </Typography>
                      </PageSection>
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
