import {
  Box,
  Stack,
  Typography,
  StatusBadge,
  Progress,
} from "@mcp-ui/core/ui";
import type { Job } from "@mcp-ui/core/models";

import { DataResult } from "../components/DataResult.component";
import { EmptyResults } from "../components/EmptyResults.component";
import {
  PaginationToolbar,
  usePagination,
} from "../components/PaginationToolbar.component";
import { SyncTotal } from "../components/SyncTotal.component";
import { sdk } from "../api/sdk";
import { useRouter } from "@tanstack/react-router";
import type { JobListRequestQuery } from "@mcp-ui/core/contracts";

const formatDate = (timestamp: number) =>
  new Date(timestamp).toLocaleString();

const JobRow = ({ job }: { job: Job }) => {
  const router = useRouter();

  return (
    <Box
      onClick={() =>
        router.navigate({ to: `/jobs/${job.id}` })
      }
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        p: 2,
        borderRadius: 1,
        cursor: "pointer",
        "&:hover": { bgcolor: "action.hover" },
        border: 1,
        borderColor: "divider",
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body1" fontWeight={600} noWrap>
          {job.type}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {formatDate(job.created)}
        </Typography>
      </Box>
      <Box sx={{ width: 200 }}>
        {job.status === "active" ? (
          <Progress value={job.progress} height={6} />
        ) : (
          <StatusBadge status={job.status} />
        )}
      </Box>
    </Box>
  );
};

export const JobsView = () => {
  const pagination = usePagination({
    defaultSortBy: "created",
    defaultSortOrder: "desc",
    limit: 20,
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

  const jobsResult = sdk.jobs.list(
    pagination.queryParams as JobListRequestQuery
  );

  return (
    <Box>
      <Typography variant="h1" gutterBottom>
        Jobs
      </Typography>
      <Stack spacing={2}>
        <PaginationToolbar {...pagination.toolbarProps} />
        <SyncTotal total={jobsResult.data?.total} setTotal={pagination.setTotal}>
          <DataResult results={{ jobsResult }}>
            {({ jobsResult: data }) =>
              data.total === 0 ? (
                <EmptyResults />
              ) : (
                <Stack spacing={1}>
                  {data.jobs.map((job) => (
                    <JobRow key={job.id} job={job} />
                  ))}
                </Stack>
              )
            }
          </DataResult>
        </SyncTotal>
      </Stack>
    </Box>
  );
};
