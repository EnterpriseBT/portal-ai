import React, { useCallback } from "react";

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
import { DateFactory } from "@portalai/core/utils";
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
import { useCapabilities } from "../utils/use-capabilities.util";

type CuratedViewRow = CuratedViewListResponsePayload["curatedViews"][number];

const dates = new DateFactory("UTC");

// ── Card (pure) ──────────────────────────────────────────────────────

interface CuratedViewCardProps {
  view: CuratedViewRow;
  canManage: boolean;
  onOpen: () => void;
  onShare: () => void;
  onDelete: () => void;
}

const CuratedViewCard: React.FC<CuratedViewCardProps> = ({
  view,
  canManage,
  onOpen,
  onShare,
  onDelete,
}) => {
  const actions: ActionSuiteItem[] = canManage
    ? [
        { label: "Share", icon: <ShareIcon />, onClick: onShare },
        {
          label: "Delete",
          icon: <DeleteIcon />,
          onClick: onDelete,
          color: "error" as const,
        },
      ]
    : [];

  return (
    <DetailCard title={view.label} onClick={onOpen} actions={actions}>
      <MetadataList
        items={[
          { label: "Key", value: view.key },
          {
            label: "Description",
            value: view.description ?? "",
            hidden: !view.description,
          },
          { label: "Row filter", value: view.filter ? "Filtered" : "All rows" },
          { label: "Created", value: dates.format(view.created, "MM/dd/yyyy") },
        ]}
      />
    </DetailCard>
  );
};

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
        icon={<Icon name={IconName.ViewColumn} />}
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
        {views.map((view) => (
          <CuratedViewCard
            key={view.id}
            view={view}
            canManage={canManage}
            onOpen={() => onOpen(view)}
            onShare={() => onShare(view)}
            onDelete={() => onDelete(view)}
          />
        ))}
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
          icon={<Icon name={IconName.ViewColumn} />}
          primaryAction={createButton}
        >
          Curated slices of connector data you can query and share.
        </PageHeader>
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

  // TODO(#599 slice 7b/7c): wire onOpen (view-detail nav) + onCreate/onShare/
  // onDelete to their dialogs. Stubbed here so 7a ships the list read-only.
  const noop = useCallback(() => undefined, []);

  return (
    <Stack spacing={4}>
      <PaginationToolbar {...pagination.toolbarProps} />
      <CuratedViewsUI
        views={listResult.data?.curatedViews ?? []}
        isLoading={listResult.isLoading}
        isError={listResult.isError}
        canManage={canManage}
        hasActiveFilters={hasActiveFilters}
        onOpen={noop}
        onCreate={noop}
        onShare={noop}
        onDelete={noop}
      />
    </Stack>
  );
};
