import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { CuratedViewListResponsePayload } from "@portalai/core/contracts";
import {
  Box,
  Button,
  DetailCard,
  Icon,
  IconName,
  MetadataList,
  PageEmptyState,
  PageHeader,
  Stack,
  type ActionSuiteItem,
} from "@portalai/core/ui";
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
      <Stack spacing={1}>
        {views.map((view) => {
          const actions: ActionSuiteItem[] = canManage
            ? [
                {
                  label: "Share",
                  icon: <ShareIcon />,
                  onClick: () => onShare(view),
                },
                {
                  label: "Delete",
                  icon: <DeleteIcon />,
                  onClick: () => onDelete(view),
                  color: "error" as const,
                },
              ]
            : [];
          return (
            <DetailCard
              key={view.id}
              title={view.label}
              onClick={() => onOpen(view)}
              actions={actions}
            >
              <MetadataList
                items={[
                  { label: "Key", value: view.key, variant: "mono" },
                  {
                    label: "Row filter",
                    value: view.filter ? "Filtered" : "All rows",
                  },
                  {
                    label: "Description",
                    value: view.description ?? "",
                    hidden: !view.description,
                  },
                ]}
              />
            </DetailCard>
          );
        })}
      </Stack>
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
