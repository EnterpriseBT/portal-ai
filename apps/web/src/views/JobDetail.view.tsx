import { JobDataStream } from "../components/Job.component";
import DataResult from "../components/DataResult.component";
import { JobDataItem, JobDetailContent } from "../components/Job.component";
import { sdk } from "../api/sdk";

interface JobDetailViewProps {
  jobId: string;
}

export const JobDetailView = ({ jobId }: JobDetailViewProps) => {
  const { mutate: cancel, isPending: isCancelling } = sdk.jobs.cancel(jobId);

  return (
    <JobDataItem id={jobId}>
      {(response) => (
        <DataResult results={{ jobResponse: response }}>
          {({ jobResponse }) => (
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
          )}
        </DataResult>
      )}
    </JobDataItem>
  );
};
