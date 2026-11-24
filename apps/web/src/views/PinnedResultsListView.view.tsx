import React, { useCallback } from "react";

import {
  CardList,
  Icon,
  IconName,
  EmptyState,
  PageHeader,
  Stack,
} from "@portalai/core/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { PinnedResultCardUI } from "../components/PinnedResultsList.component";
import DataResult from "../components/DataResult.component";
import { EmptyResults } from "../components/EmptyResults.component";
import { emptyListHelp } from "../utils/empty-list-help.util";
import {
  PaginationToolbar,
  usePagination,
} from "../components/PaginationToolbar.component";
import { SyncTotal } from "../components/SyncTotal.component";
import { sdk } from "../api/sdk";
import { useToast } from "../utils/toast.context";
import type {
  PortalResultsListPayload,
  PortalResultsListParams,
} from "../api/portal-results.api";
import { useTagFilter } from "../utils/use-tag-filter.util";
import { FAVORITE_FILTER } from "../utils/favorite-filter.util";
import { FavoriteToggle } from "../components/FavoriteToggle.component";
import { FavoritesEmptyResults } from "../components/FavoritesEmptyResults.component";
import { pinDeleteKeys } from "../utils/delete-invalidation.util";

// ── Data fetcher ────────────────────────────────────────────────────

interface PinnedResultsDataListProps {
  query: PortalResultsListParams;
  children: (
    data: ReturnType<typeof sdk.portalResults.list>
  ) => React.ReactNode;
}

const PinnedResultsDataList: React.FC<PinnedResultsDataListProps> = ({
  query,
  children,
}) => {
  const res = sdk.portalResults.list(query);
  return <>{children(res)}</>;
};

// ── View ────────────────────────────────────────────────────────────

export const PinnedResultsListView: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const removeMutation = sdk.portalResults.remove();
  const tagFilter = useTagFilter();

  const pagination = usePagination({
    sortFields: [{ field: "created", label: "Created" }],
    defaultSortBy: "created",
    defaultSortOrder: "desc",
    filters: [FAVORITE_FILTER, tagFilter],
  });

  // #312 (closes the UNPIN_SDK_BYPASS remainder): unpin routes through the
  // SDK; failures raise a persistent toast with Retry (Toast Pattern).
  const handleUnpin = useCallback(
    async function attempt(id: string): Promise<void> {
      try {
        await removeMutation.mutateAsync({ id });
        for (const queryKey of pinDeleteKeys()) {
          queryClient.invalidateQueries({ queryKey });
        }
      } catch {
        toast.error("Could not remove this pinned result. Please try again.", {
          action: { label: "Retry", onClick: () => void attempt(id) },
        });
      }
    },
    [removeMutation, queryClient, toast]
  );

  return (
    <Stack spacing={4}>
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Pinned Results" },
        ]}
        onNavigate={(href) => navigate({ to: href })}
        title="Pinned Results"
        icon={<Icon name={IconName.PushPin} />}
      />
      <Stack spacing={2}>
        <PaginationToolbar {...pagination.toolbarProps} />
        <PinnedResultsDataList
          query={
            {
              ...pagination.queryParams,
              include: "tags",
            } as PortalResultsListParams
          }
        >
          {(response) => (
            <SyncTotal
              total={response.data?.total}
              setTotal={pagination.setTotal}
            >
              <DataResult results={{ pinned: response }}>
                {({ pinned }) => {
                  const payload = pinned as unknown as PortalResultsListPayload;
                  const results = payload.portalResults;
                  if (payload.total === 0) {
                    if (pagination.isOnlyFilter(FAVORITE_FILTER.field)) {
                      return <FavoritesEmptyResults noun="pinned result" />;
                    }
                    const hasActiveFilters = pagination.isFiltered;
                    return hasActiveFilters ? (
                      <EmptyResults />
                    ) : (
                      <EmptyState
                        icon={<Icon name={IconName.PushPin} />}
                        title="No pinned results"
                        {...emptyListHelp("pinnedResults")}
                      />
                    );
                  }
                  return (
                    <CardList aria-label="Pinned results">
                      {results.map((result) => (
                        <PinnedResultCardUI
                          key={result.id}
                          result={result}
                          headingLevel={2}
                          onUnpin={handleUnpin}
                          titleAction={
                            <FavoriteToggle
                              target={{ type: "pin", id: result.id }}
                              name={result.name}
                              isFavorite={result.isFavorite ?? false}
                            />
                          }
                        />
                      ))}
                    </CardList>
                  );
                }}
              </DataResult>
            </SyncTotal>
          )}
        </PinnedResultsDataList>
      </Stack>
    </Stack>
  );
};
