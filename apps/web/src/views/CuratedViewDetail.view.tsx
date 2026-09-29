import React, { useMemo, useState } from "react";

import type {
  CuratedViewGetResponsePayload,
  CuratedViewRecordColumn,
  CuratedViewRecordsResponsePayload,
} from "@portalai/core/contracts";
import {
  Box,
  Button,
  DataTable,
  Icon,
  IconName,
  MetadataList,
  PageEmptyState,
  PageHeader,
  PageSection,
  Stack,
  type DataTableColumn,
} from "@portalai/core/ui";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { useNavigate, useParams } from "@tanstack/react-router";

import { EmptyResults } from "../components/EmptyResults.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { CuratedViewEditorDialog } from "../components/CuratedViewEditorDialog.component";
import { DeleteCuratedViewDialog } from "../components/DeleteCuratedViewDialog.component";
import { sdk } from "../api/sdk";
import { queryKeys } from "../api/keys";
import { useQueryClient } from "@tanstack/react-query";
import { useCapabilities } from "../utils/use-capabilities.util";
import { useToast } from "../utils/toast.context";
import { toServerError } from "../utils/api.util";

type CuratedView = CuratedViewGetResponsePayload["curatedView"];
type RecordRow = CuratedViewRecordsResponsePayload["records"][number];

// ── Pure UI ──────────────────────────────────────────────────────────

export interface CuratedViewDetailUIProps {
  view: CuratedView;
  /** The view's projected columns (server-resolved) — the sortable headers. */
  columns: CuratedViewRecordColumn[];
  records: RecordRow[];
  recordsLoading: boolean;
  recordsError: boolean;
  /** Whether the caller may edit/delete the view (admin). */
  canManage: boolean;
  /** The rendered pagination toolbar (search / sort / page controls). */
  paginationToolbar: React.ReactNode;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  onSort: (column: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onNavigate: (href: string) => void;
}

export const CuratedViewDetailUI: React.FC<CuratedViewDetailUIProps> = ({
  view,
  columns,
  records,
  recordsLoading,
  recordsError,
  canManage,
  paginationToolbar,
  sortColumn,
  sortDirection,
  onSort,
  onEdit,
  onDelete,
  onNavigate,
}) => {
  const tableColumns: DataTableColumn[] = useMemo(
    () =>
      columns.map((c) => ({
        key: c.key,
        label: c.label,
        sortable: true,
        render: (value) =>
          value === null || value === undefined ? "" : String(value),
      })),
    [columns]
  );

  let recordsBody: React.ReactNode;
  if (recordsError) {
    recordsBody = <EmptyResults />;
  } else if (!recordsLoading && records.length === 0) {
    recordsBody = (
      <PageEmptyState
        icon={<Icon name={IconName.Layers} />}
        title="No rows"
        description="This view currently returns no rows for you."
      />
    );
  } else {
    recordsBody = (
      <DataTable
        columns={tableColumns}
        rows={records as unknown as Record<string, unknown>[]}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSort={onSort}
        emptyMessage="No rows"
      />
    );
  }

  return (
    <Box>
      <Stack spacing={4}>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "Views", href: "/views" },
            { label: view.label },
          ]}
          onNavigate={onNavigate}
          title={view.label}
          icon={<Icon name={IconName.Layers} />}
          primaryAction={
            canManage ? (
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  startIcon={<EditIcon />}
                  onClick={onEdit}
                >
                  Edit
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={onDelete}
                >
                  Delete
                </Button>
              </Stack>
            ) : undefined
          }
        />

        <MetadataList
          direction="vertical"
          layout="responsive"
          items={[
            { label: "Key", value: view.key, variant: "mono" },
            {
              label: "Description",
              value: view.description ?? "",
              hidden: !view.description,
            },
            {
              label: "Row filter",
              value: view.filter ? "Filtered" : "All rows",
            },
            {
              label: "Columns",
              value: view.fieldMappingIds.length
                ? `${view.fieldMappingIds.length} selected`
                : "All columns",
            },
          ]}
        />

        <PageSection title="Records" icon={<Icon name={IconName.Layers} />}>
          {paginationToolbar}
          <Box sx={{ mt: 2 }}>{recordsBody}</Box>
        </PageSection>
      </Stack>
    </Box>
  );
};

// ── Container ────────────────────────────────────────────────────────

export const CuratedViewDetail: React.FC = () => {
  const { viewId } = useParams({ from: "/views/$viewId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { canOnResource } = useCapabilities();
  const canManage = canOnResource("curated_view", "write");

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const viewResult = sdk.curatedViews.get(viewId);
  const pagination = usePagination({
    sortFields: [],
    defaultSortBy: "created",
    defaultSortOrder: "asc",
  });
  const recordsResult = sdk.curatedViews.records(
    viewId,
    pagination.queryParams as Parameters<typeof sdk.curatedViews.records>[1]
  );

  React.useEffect(() => {
    if (recordsResult.data?.total !== undefined) {
      pagination.setTotal(recordsResult.data.total);
    }
  }, [recordsResult.data?.total, pagination]);

  const {
    mutate: removeView,
    isPending: isDeleting,
    error: deleteError,
  } = sdk.curatedViews.delete(viewId);

  const view = viewResult.data?.curatedView;
  if (!view) {
    if (viewResult.isError) {
      return (
        <PageEmptyState
          icon={<Icon name={IconName.Layers} />}
          title="View not found"
          description="This view does not exist or is not available to you."
        />
      );
    }
    return null;
  }

  const handleDelete = () => {
    removeView(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.curatedViews.root,
        });
        toast.success(`Deleted "${view.label}"`);
        navigate({ to: "/views" });
      },
    });
  };

  const handleSort = (column: string) => {
    if (pagination.sortBy === column) {
      pagination.toggleSortOrder();
    } else {
      pagination.setSortBy(column);
      pagination.setSortOrder("asc");
    }
    // Re-sorting changes the whole ordering — return to page one (offset mode
    // doesn't reset on sort the way keyset does).
    pagination.setOffset(0);
  };

  return (
    <Stack spacing={4}>
      <CuratedViewDetailUI
        view={view}
        columns={recordsResult.data?.columns ?? []}
        records={recordsResult.data?.records ?? []}
        recordsLoading={recordsResult.isLoading}
        recordsError={recordsResult.isError}
        canManage={canManage}
        paginationToolbar={<PaginationToolbar {...pagination.toolbarProps} />}
        sortColumn={pagination.sortBy}
        sortDirection={pagination.sortOrder}
        onSort={handleSort}
        onEdit={() => setEditOpen(true)}
        onDelete={() => setDeleteOpen(true)}
        onNavigate={(href) => navigate({ to: href })}
      />
      <CuratedViewEditorDialog
        open={editOpen}
        mode="edit"
        view={view}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          queryClient.invalidateQueries({
            queryKey: queryKeys.curatedViews.root,
          });
        }}
      />
      <DeleteCuratedViewDialog
        open={deleteOpen}
        viewLabel={view.label}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        isPending={isDeleting}
        serverError={toServerError(deleteError as never)}
      />
    </Stack>
  );
};
