import React, { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { CuratedViewListResponsePayload } from "@portalai/core/contracts";
import {
  Box,
  Button,
  DataTable,
  Icon,
  IconName,
  PageEmptyState,
  PageHeader,
  Stack,
  type DataTableColumn,
} from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import IconButton from "@mui/material/IconButton";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import ShareIcon from "@mui/icons-material/Share";
import { useNavigate } from "@tanstack/react-router";

import { EmptyResults } from "../components/EmptyResults.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { sdk } from "../api/sdk";
import { queryKeys } from "../api/keys";
import { useCapabilities } from "../utils/use-capabilities.util";
import { useToast } from "../utils/toast.context";
import { toServerError } from "../utils/api.util";
import { CuratedViewEditorDialog } from "../components/CuratedViewEditorDialog.component";
import { DeleteCuratedViewDialog } from "../components/DeleteCuratedViewDialog.component";
import { ShareDialog } from "../components/ShareDialog.component";

type CuratedViewRow = CuratedViewListResponsePayload["curatedViews"][number];

const dates = new DateFactory("UTC");

// ── List view (pure UI — renders from props, no fetching) ────────────

export interface CuratedViewsUIProps {
  views: CuratedViewRow[];
  isLoading: boolean;
  isError: boolean;
  /** Whether the caller may create/delete/share views (admin). When false the
   *  management affordances are hidden and the list is read-only. */
  canManage: boolean;
  /** True when a search/filter is active — drives the empty-state copy. */
  hasActiveFilters: boolean;
  /** The rendered pagination toolbar (search / sort / page controls). */
  paginationToolbar: React.ReactNode;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  onSort: (column: string) => void;
  onOpen: (view: CuratedViewRow) => void;
  onCreate: () => void;
  onShare: (view: CuratedViewRow) => void;
  onDelete: (view: CuratedViewRow) => void;
}

export const CuratedViewsUI: React.FC<CuratedViewsUIProps> = ({
  views,
  isLoading,
  isError,
  canManage,
  hasActiveFilters,
  paginationToolbar,
  sortColumn,
  sortDirection,
  onSort,
  onOpen,
  onCreate,
  onShare,
  onDelete,
}) => {
  const navigate = useNavigate();

  const createButton = canManage ? (
    <Button variant="contained" startIcon={<AddIcon />} onClick={onCreate}>
      Create View
    </Button>
  ) : undefined;

  const columns: DataTableColumn[] = useMemo(() => {
    const base: DataTableColumn[] = [
      { key: "label", label: "Name", sortable: true },
      { key: "key", label: "Key", sortable: true },
      {
        key: "filter",
        label: "Row filter",
        render: (value) => (value ? "Filtered" : "All rows"),
      },
      {
        key: "description",
        label: "Description",
        render: (value) => {
          const text = String(value ?? "");
          return text.length > 90 ? `${text.slice(0, 90)}…` : text;
        },
      },
      {
        key: "created",
        label: "Created",
        sortable: true,
        format: (value) => dates.format(Number(value), "MM/dd/yyyy"),
      },
    ];
    if (!canManage) return base;
    base.push({
      key: "actions",
      label: "Actions",
      render: (_value, row) => (
        <Stack direction="row" spacing={0.5}>
          <IconButton
            size="small"
            aria-label="Share view"
            onClick={(e) => {
              e.stopPropagation();
              onShare(row as unknown as CuratedViewRow);
            }}
          >
            <ShareIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color="error"
            aria-label="Delete view"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(row as unknown as CuratedViewRow);
            }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      ),
    });
    return base;
  }, [canManage, onShare, onDelete]);

  let body: React.ReactNode;
  if (isError) {
    body = <EmptyResults />;
  } else if (!isLoading && views.length === 0) {
    body = hasActiveFilters ? (
      <EmptyResults />
    ) : (
      <PageEmptyState
        icon={<Icon name={IconName.Layers} />}
        title="No views available"
        description={
          canManage
            ? "Create a view to expose a curated slice of connector data."
            : "No views have been shared with you yet."
        }
        action={createButton}
      />
    );
  } else {
    body = (
      <DataTable
        columns={columns}
        rows={views as unknown as Record<string, unknown>[]}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSort={onSort}
        onRowClick={(row) => onOpen(row as unknown as CuratedViewRow)}
        emptyMessage="No views available"
      />
    );
  }

  return (
    <Box>
      <Stack spacing={4}>
        <PageHeader
          breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Views" }]}
          onNavigate={(href) => navigate({ to: href })}
          title="Views"
          icon={<Icon name={IconName.Layers} />}
          primaryAction={createButton}
        />
        {paginationToolbar}
        {body}
      </Stack>
    </Box>
  );
};

// ── Container (wires hooks + fetching) ───────────────────────────────

export const CuratedViews: React.FC = () => {
  const { canOnResource } = useCapabilities();
  const canManage = canOnResource("curated_view", "write");

  const pagination = usePagination({
    sortFields: [
      { field: "label", label: "Label" },
      { field: "key", label: "Key" },
      { field: "created", label: "Created" },
    ],
    defaultSortBy: "created",
    defaultSortOrder: "asc",
  });

  const listResult = sdk.curatedViews.list(
    pagination.queryParams as Parameters<typeof sdk.curatedViews.list>[0]
  );

  React.useEffect(() => {
    if (listResult.data?.total !== undefined) {
      pagination.setTotal(listResult.data.total);
    }
  }, [listResult.data?.total, pagination]);

  const hasActiveFilters = Boolean(
    pagination.search ||
    Object.values(pagination.filters).some((v) => v.length > 0)
  );

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CuratedViewRow | null>(null);
  const [shareTarget, setShareTarget] = useState<CuratedViewRow | null>(null);

  const {
    mutate: deleteView,
    isPending: isDeleting,
    error: deleteError,
  } = sdk.curatedViews.delete(deleteTarget?.id ?? "");

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    const label = deleteTarget.label;
    deleteView(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.curatedViews.root,
        });
        toast.success(`Deleted "${label}"`);
        setDeleteTarget(null);
      },
    });
  };

  return (
    <>
      <CuratedViewsUI
        views={listResult.data?.curatedViews ?? []}
        isLoading={listResult.isLoading}
        isError={listResult.isError}
        canManage={canManage}
        hasActiveFilters={hasActiveFilters}
        paginationToolbar={<PaginationToolbar {...pagination.toolbarProps} />}
        sortColumn={pagination.sortBy}
        sortDirection={pagination.sortOrder}
        onSort={pagination.setSortBy}
        onOpen={(view) => navigate({ to: `/views/${view.id}` })}
        onCreate={() => setCreateOpen(true)}
        onShare={(view) => setShareTarget(view)}
        onDelete={(view) => setDeleteTarget(view)}
      />
      <CuratedViewEditorDialog
        open={createOpen}
        mode="create"
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          queryClient.invalidateQueries({
            queryKey: queryKeys.curatedViews.root,
          });
        }}
      />
      <DeleteCuratedViewDialog
        open={deleteTarget !== null}
        viewLabel={deleteTarget?.label ?? ""}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        isPending={isDeleting}
        serverError={toServerError(deleteError as never)}
      />
      <ShareDialog
        open={shareTarget !== null}
        onClose={() => setShareTarget(null)}
        resourceType="curated_view"
        resourceId={shareTarget?.id ?? ""}
        resourceLabel={shareTarget?.label ?? ""}
      />
    </>
  );
};
