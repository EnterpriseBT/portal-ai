import DataResult from "../components/DataResult.component";
import { JobDataItem, JobDetailContent } from "../components/Job.component";
import { sdk } from "../api/sdk";
import { useJobStream } from "../utils/job-stream.util";

interface JobDetailViewProps {
  jobId: string;
}

export const JobDetailView = ({ jobId }: JobDetailViewProps) => {
  const stream = useJobStream(jobId);
  const { mutate: cancel, isPending: isCancelling } = sdk.jobs.cancel(jobId);

  return (
    <JobDataItem id={jobId}>
      {(response) => (
        <DataResult results={{ jobResponse: response }}>
          {({ jobResponse }) => (
            <JobDetailContent
              job={jobResponse.job}
              stream={stream}
              onCancel={() => cancel()}
              isCancelling={isCancelling}
            />
          )}
        </DataResult>
      )}
    </JobDataItem>
  );
};
