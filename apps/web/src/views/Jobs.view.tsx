import {
  Icon,
  IconName,
  PageEmptyState,
  PageHeader,
  Stack,
} from "@portalai/core/ui";
import type { JobListRequestQuery } from "@portalai/core/contracts";
import { useNavigate } from "@tanstack/react-router";

import { JobDataStream } from "../components/Job.component";
import DataResult from "../components/DataResult.component";
import { EmptyResults } from "../components/EmptyResults.component";
import { JobCard, JobDataList } from "../components/Job.component";
import {
  PaginationToolbar,
  usePagination,
} from "../components/PaginationToolbar.component";
import { SyncTotal } from "../components/SyncTotal.component";

export const JobsView = () => {
  const navigate = useNavigate();

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
        type: "multi-select",
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
        type: "multi-select",
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
    <Stack spacing={4}>
      <PageHeader
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Jobs" }]}
        onNavigate={(href) => navigate({ to: href })}
        title="Jobs"
        icon={<Icon name={IconName.Work} />}
      />
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
                    pagination.search ||
                    Object.values(pagination.filters).some(
                      (v) => v.length > 0
                    ) ? (
                      <EmptyResults />
                    ) : (
                      <PageEmptyState
                        icon={<Icon name={IconName.Work} />}
                        title="No jobs found"
                      />
                    )
                  ) : (
                    <Stack spacing={1}>
                      {jobs.jobs.map((job) => (
                        <JobDataStream key={job.id} job={job}>
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
                        </JobDataStream>
                      ))}
                    </Stack>
                  )
                }
              </DataResult>
            </SyncTotal>
          )}
        </JobDataList>
      </Stack>
    </Stack>
  );
};
