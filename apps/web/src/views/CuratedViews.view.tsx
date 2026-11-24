import React, { useState } from "react";

import type { CuratedViewListResponsePayload } from "@portalai/core/contracts";
import { isSessionGenerated } from "@portalai/core/models";
import {
  Box,
  CardList,
  DetailCard,
  GatedButton,
  Icon,
  IconName,
  MetadataList,
  EmptyState,
  PageHeader,
  Stack,
  type ActionGate,
  type ActionSuiteItem,
} from "@portalai/core/ui";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import ShareIcon from "@mui/icons-material/Share";
import { useNavigate } from "@tanstack/react-router";

import { EmptyResults } from "../components/EmptyResults.component";
import { emptyListHelp } from "../utils/empty-list-help.util";
import { RouterLink } from "../components/RouterLink.component";
import { SessionGeneratedChipUI } from "../components/SessionGeneratedChip.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { sdk } from "../api/sdk";
import { decideActionGate } from "../utils/action-gate.util";
import { useCreateGate } from "../utils/use-create-gate.util";
import { toServerError } from "../utils/api.util";
import { CuratedViewEditorDialog } from "../components/CuratedViewEditorDialog.component";
import { DeleteCuratedViewDialog } from "../components/DeleteCuratedViewDialog.component";
import { ShareDialog } from "../components/ShareDialog.component";
import { TagChipListUI } from "../components/TagChipList.component";
import { useTagFilter } from "../utils/use-tag-filter.util";
import { FAVORITE_FILTER } from "../utils/favorite-filter.util";
import { FavoriteToggle } from "../components/FavoriteToggle.component";
import { FavoritesEmptyResults } from "../components/FavoritesEmptyResults.component";
import { curatedViewDeleteKeys } from "../utils/delete-invalidation.util";

type CuratedViewRow = CuratedViewListResponsePayload["curatedViews"][number];

// ── List view (pure UI — renders from props, no fetching) ────────────

export interface CuratedViewsUIProps {
  views: CuratedViewRow[];
  isLoading: boolean;
  isError: boolean;
  /** #688: the page's Create action. Each row's Share and Delete are gated by
   *  that row's own `capabilities`. */
  createGate: ActionGate;
  /** True when a search/filter is active — drives the empty-state copy. */
  hasActiveFilters: boolean;
  /** #1072: the Favorites toggle is the one active filter (empty = nothing starred). */
  favoritesOnly?: boolean;
  /** #1072: the control beside each view's name (its favorite star). */
  renderTitleAction?: (view: CuratedViewRow) => React.ReactNode;
  /** The rendered pagination toolbar (search / sort / page controls). */
  paginationToolbar: React.ReactNode;
  onCreate: () => void;
  onShare: (view: CuratedViewRow) => void;
  onDelete: (view: CuratedViewRow) => void;
}

export const CuratedViewsUI: React.FC<CuratedViewsUIProps> = ({
  views,
  isLoading,
  isError,
  createGate,
  hasActiveFilters,
  favoritesOnly,
  renderTitleAction,
  paginationToolbar,
  onCreate,
  onShare,
  onDelete,
}) => {
  const navigate = useNavigate();

  const createButton =
    createGate.kind === "hide" ? undefined : (
      <GatedButton
        gate={createGate}
        variant="contained"
        startIcon={<AddIcon />}
        onClick={onCreate}
      >
        Create View
      </GatedButton>
    );

  let body: React.ReactNode;
  if (isError) {
    body = <EmptyResults />;
  } else if (!isLoading && views.length === 0 && favoritesOnly) {
    body = <FavoritesEmptyResults noun="view" />;
  } else if (!isLoading && views.length === 0) {
    body = hasActiveFilters ? (
      <EmptyResults />
    ) : (
      <EmptyState
        icon={<Icon name={IconName.Layers} />}
        title="No views available"
        {...emptyListHelp("views")}
      />
    );
  } else {
    body = (
      <CardList aria-label="Views">
        {views.map((view) => {
          // #688: what this caller may do to this view.
          const actions: ActionSuiteItem[] = [
            {
              label: "Share",
              icon: <ShareIcon />,
              onClick: () => onShare(view),
              gate: decideActionGate({ allowed: view.capabilities.share }),
            },
            {
              label: "Delete",
              icon: <DeleteIcon />,
              onClick: () => onDelete(view),
              color: "error" as const,
              gate: decideActionGate({ allowed: view.capabilities.delete }),
            },
          ];
          return (
            // #794: the card opens its view through its title's link.
            <DetailCard
              key={view.id}
              title={view.label}
              href={`/views/${view.id}`}
              linkComponent={RouterLink}
              headingLevel={2}
              actions={actions}
              titleAction={renderTitleAction?.(view)}
            >
              <MetadataList
                items={[
                  {
                    // Fall back to the key on an empty label (`||`, not `??`),
                    // and hide the row when neither resolves.
                    label: "Entity",
                    value: view.entity?.label || view.entity?.key || "",
                    hidden: !(view.entity?.label || view.entity?.key),
                  },
                  { label: "Key", value: view.key, variant: "mono" },
                  {
                    label: "Row filter",
                    // #680: `filter` is null for a reader without write.
                    value: view.filtered ? "Filtered" : "All rows",
                  },
                  {
                    label: "Description",
                    value: view.description ?? "",
                    hidden: !view.description,
                  },
                  {
                    // #645: provenance only; the view is still its creator's.
                    label: "Provenance",
                    value: <SessionGeneratedChipUI />,
                    variant: "chip",
                    hidden: !isSessionGenerated(view),
                  },
                  {
                    label: "Tags",
                    value: <TagChipListUI tags={view.tags} />,
                    variant: "chip",
                    hidden: !view.tags?.length,
                  },
                ]}
              />
            </DetailCard>
          );
        })}
      </CardList>
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
  // #708: Create decides from the create route's own check.
  const createGate = useCreateGate(
    "curated_view",
    "Ask for access to create views"
  );

  const tagFilter = useTagFilter();
  const pagination = usePagination({
    sortFields: [
      { field: "label", label: "Label" },
      { field: "key", label: "Key" },
      { field: "created", label: "Created" },
    ],
    defaultSortBy: "created",
    defaultSortOrder: "asc",
    filters: [FAVORITE_FILTER, tagFilter],
  });

  const listResult = sdk.curatedViews.list({
    ...pagination.queryParams,
    include: "tags",
  } as Parameters<typeof sdk.curatedViews.list>[0]);

  React.useEffect(() => {
    if (listResult.data?.total !== undefined) {
      pagination.setTotal(listResult.data.total);
    }
  }, [listResult.data?.total, pagination]);

  const hasActiveFilters = pagination.isFiltered;

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
      invalidate: curatedViewDeleteKeys(),
      toast: { success: `Deleted "${label}"` },
      onSuccess: () => setDeleteTarget(null),
    });
  };

  return (
    <>
      <CuratedViewsUI
        views={listResult.data?.curatedViews ?? []}
        isLoading={listResult.isLoading}
        isError={listResult.isError}
        createGate={createGate}
        hasActiveFilters={hasActiveFilters}
        favoritesOnly={pagination.isOnlyFilter(FAVORITE_FILTER.field)}
        renderTitleAction={(view) => (
          <FavoriteToggle
            target={{ type: "curated_view", id: view.id }}
            name={view.label}
            isFavorite={view.isFavorite ?? false}
          />
        )}
        paginationToolbar={<PaginationToolbar {...pagination.toolbarProps} />}
        onCreate={() => setCreateOpen(true)}
        onShare={(view) => setShareTarget(view)}
        onDelete={(view) => setDeleteTarget(view)}
      />
      <CuratedViewEditorDialog
        open={createOpen}
        mode="create"
        onClose={() => setCreateOpen(false)}
        // The dialog's save refreshes the views itself (#985).
        onSaved={() => setCreateOpen(false)}
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
