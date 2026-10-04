import React, { useState } from "react";

import type {
  CuratedViewGetResponsePayload,
  CuratedViewRecordsResponsePayload,
  ResolvedColumn,
} from "@portalai/core/contracts";
import {
  Box,
  GatedButton,
  Icon,
  IconName,
  MetadataList,
  PageEmptyState,
  PageHeader,
  PageSection,
  Stack,
} from "@portalai/core/ui";
import CircularProgress from "@mui/material/CircularProgress";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { useNavigate, useParams } from "@tanstack/react-router";

import { EmptyResults } from "../components/EmptyResults.component";
import { EntityRecordDataTableUI } from "../components/EntityRecordDataTable.component";
import { PaginationToolbar } from "../components/PaginationToolbar.component";
import {
  useCuratedViewTablePagination,
  type CuratedViewTableRecovery,
} from "../utils/curated-view-table.util";
import { CuratedViewEditorDialog } from "../components/CuratedViewEditorDialog.component";
import { DeleteCuratedViewDialog } from "../components/DeleteCuratedViewDialog.component";
import { sdk } from "../api/sdk";
import { queryKeys } from "../api/keys";
import { useQueryClient } from "@tanstack/react-query";
import { decideActionGate } from "../utils/action-gate.util";
import { useToast } from "../utils/toast.context";
import { toServerError } from "../utils/api.util";

type CuratedView = CuratedViewGetResponsePayload["curatedView"];
type RecordRow = CuratedViewRecordsResponsePayload["records"][number];

// ── Pure UI ──────────────────────────────────────────────────────────

export interface CuratedViewDetailUIProps {
  view: CuratedView;
  /** #678: the caller's readable projected columns (server-resolved), in the
   *  entity table's ResolvedColumn shape. The whole set the table can show,
   *  sort, reorder or hide. */
  columns: ResolvedColumn[];
  records: RecordRow[];
  recordsLoading: boolean;
  recordsError: boolean;
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
  paginationToolbar,
  sortColumn,
  sortDirection,
  onSort,
  onEdit,
  onDelete,
  onNavigate,
}) => {
  // #688: what this caller may do to this view.
  const editGate = decideActionGate({ allowed: view.capabilities.write });
  const deleteGate = decideActionGate({ allowed: view.capabilities.delete });

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
  } else if (columns.length === 0) {
    // The columns arrive with the first records response. Mounting the table
    // before then would reconcile the saved column config against no columns
    // and drop it, so a hidden or reordered column came back on every reload.
    recordsBody = <CircularProgress size={20} />;
  } else {
    // #678: the same table as the entity records page (normalizedKey headers
    // with a label · type caption, type-aware cells, sortable types only, the
    // column picker), minus what a view doesn't have: no validity column and
    // no Cached/Live chip. Column config is remembered per view.
    recordsBody = (
      <EntityRecordDataTableUI
        connectorEntityId={view.connectorEntityId}
        columns={columns}
        rows={records as unknown as Record<string, unknown>[]}
        showValidity={false}
        columnConfigKey={`column-config:curated-view:${view.id}`}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSort={onSort}
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
            editGate.kind === "hide" &&
            deleteGate.kind === "hide" ? undefined : (
              <Stack direction="row" spacing={1}>
                <GatedButton
                  gate={editGate}
                  variant="outlined"
                  startIcon={<EditIcon />}
                  onClick={onEdit}
                >
                  Edit
                </GatedButton>
                <GatedButton
                  gate={deleteGate}
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={onDelete}
                >
                  Delete
                </GatedButton>
              </Stack>
            )
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
              // #680: a reader without write gets filter: null; `filtered` is
              // what every reader may know.
              value: view.filtered ? "Filtered" : "All rows",
            },
            {
              label: "Columns",
              // `fieldMappingIds` holds only the columns this caller can read,
              // so a projected view shows their count, never "All columns".
              value: view.projected
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
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const viewResult = sdk.curatedViews.get(viewId);
  // #678: the caller's readable projected columns, captured from the records
  // response. They drive the table, its column picker and the advanced filter
  // builder; paging and filters are remembered per view.
  const [columns, setColumns] = useState<ResolvedColumn[]>([]);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // The hook resets a filter or sort the server refused; say why it changed.
  const onRecovered = React.useCallback(
    (what: CuratedViewTableRecovery) =>
      toast.info(
        what === "filter"
          ? "Your filter referenced a column you can't use in this view, so it was cleared."
          : "That column can't be sorted any more, so the table's sort was reset."
      ),
    [toast]
  );
  const pagination = useCuratedViewTablePagination(viewId, columns, {
    errorCode,
    onRecovered,
  });
  const recordsResult = sdk.curatedViews.records(
    viewId,
    pagination.queryParams as Parameters<typeof sdk.curatedViews.records>[1]
  );

  React.useEffect(() => {
    if (recordsResult.data?.columns) setColumns(recordsResult.data.columns);
  }, [recordsResult.data?.columns]);
  React.useEffect(() => {
    setErrorCode(toServerError(recordsResult.error)?.code ?? null);
  }, [recordsResult.error]);

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
        columns={recordsResult.data?.columns ?? columns}
        records={recordsResult.data?.records ?? []}
        recordsLoading={recordsResult.isLoading}
        recordsError={recordsResult.isError}
        paginationToolbar={<PaginationToolbar {...pagination.toolbarProps} />}
        sortColumn={pagination.sortBy}
        sortDirection={pagination.sortOrder}
        onSort={handleSort}
        onEdit={() => setEditOpen(true)}
        onDelete={() => setDeleteOpen(true)}
        onNavigate={(href) => navigate({ to: href })}
      />
      <CuratedViewEditorDialog
        // #688: the editor never opens without write on the view.
        open={editOpen && view.capabilities.write}
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
