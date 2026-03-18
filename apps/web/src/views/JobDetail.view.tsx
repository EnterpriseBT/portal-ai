import { Box, Breadcrumbs } from "@portalai/core/ui";
import { IconName } from "@portalai/core/ui";
import { useNavigate } from "@tanstack/react-router";

import { JobDataStream } from "../components/Job.component";
import DataResult from "../components/DataResult.component";
import { JobDataItem, JobDetailContent } from "../components/Job.component";
import { sdk } from "../api/sdk";

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
            <Box>
              <Breadcrumbs
                items={[
                  { label: "Dashboard", href: "/", icon: IconName.Home },
                  { label: "Jobs", href: "/jobs" },
                  { label: jobResponse.job.type },
                ]}
                onNavigate={(href) => navigate({ to: href })}
              />
              <JobDataStream job={jobResponse.job}>
                {(stream) => (
                  <JobDetailContent
                    job={jobResponse.job}
                    stream={stream}
                    onCancel={() => cancel()}
                    isCancelling={isCancelling}
                  />
                )}
              </JobDataStream>
            </Box>
          )}
        </DataResult>
      )}
    </JobDataItem>
  );
};
