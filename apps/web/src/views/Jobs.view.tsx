import { Box, Stack, Typography } from "@portalai/core/ui";
import type { JobListRequestQuery } from "@portalai/core/contracts";

import { DataJobStream } from "../components/DataJobStream.component";
import DataResult from "../components/DataResult.component";
import { EmptyResults } from "../components/EmptyResults.component";
import { JobCard, JobDataList } from "../components/Job.component";
import {
  PaginationToolbar,
  usePagination,
} from "../components/PaginationToolbar.component";
import { SyncTotal } from "../components/SyncTotal.component";

export const JobsView = () => {
  const pagination = usePagination({
    defaultSortBy: "created",
    defaultSortOrder: "desc",
    limit: 5,
    sortFields: [
      { field: "created", label: "Created" },
      { field: "type", label: "Type" },
      { field: "status", label: "Status" },
    ],
    filters: [
      {
        type: "select",
        field: "status",
        label: "Status",
        options: [
          { label: "Pending", value: "pending" },
          { label: "Active", value: "active" },
          { label: "Completed", value: "completed" },
          { label: "Failed", value: "failed" },
          { label: "Cancelled", value: "cancelled" },
        ],
      },
      {
        type: "select",
        field: "type",
        label: "Type",
        options: [
          { label: "System Check", value: "system_check" },
          { label: "File Upload", value: "file_upload" },
        ],
      },
    ],
  });

  return (
    <Box>
      <Typography variant="h1" gutterBottom>
        Jobs
      </Typography>
      <Stack spacing={2}>
        <PaginationToolbar {...pagination.toolbarProps} />
        <JobDataList query={pagination.queryParams as JobListRequestQuery}>
          {(response) => (
            <SyncTotal
              total={response.data?.total}
              setTotal={pagination.setTotal}
            >
              <DataResult results={{ jobs: response }}>
                {({ jobs }) =>
                  jobs.total === 0 ? (
                    <EmptyResults />
                  ) : (
                    <Stack spacing={1}>
                      {jobs.jobs.map((job) => (
                        <DataJobStream key={job.id} job={job}>
                          {(stream) => (
                            <JobCard
                              job={job}
                              status={stream.status ?? undefined}
                              progress={
                                stream.status !== null
                                  ? stream.progress
                                  : undefined
                              }
                            />
                          )}
                        </DataJobStream>
                      ))}
                    </Stack>
                  )
                }
              </DataResult>
            </SyncTotal>
          )}
        </JobDataList>
      </Stack>
    </Box>
  );
};
