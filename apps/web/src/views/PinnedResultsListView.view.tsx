import React, { useCallback } from "react";

import type { PortalResult } from "@portalai/core/models";
import { Box, Breadcrumbs, Stack, Typography, IconName } from "@portalai/core/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { PinnedResultCardUI } from "../components/PinnedResultsList.component";
import DataResult from "../components/DataResult.component";
import { EmptyResults } from "../components/EmptyResults.component";
import {
  PaginationToolbar,
  usePagination,
} from "../components/PaginationToolbar.component";
import { SyncTotal } from "../components/SyncTotal.component";
import { sdk, queryKeys } from "../api/sdk";
import { useAuthFetch } from "../utils/api.util";
import type { PortalResultsListPayload, PortalResultsListParams } from "../api/portal-results.api";

// ── Data fetcher ────────────────────────────────────────────────────

interface PinnedResultsDataListProps {
  query: PortalResultsListParams;
  children: (data: ReturnType<typeof sdk.portalResults.list>) => React.ReactNode;
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
  const { fetchWithAuth } = useAuthFetch();

  const pagination = usePagination({
    sortFields: [{ field: "created", label: "Created" }],
    defaultSortBy: "created",
    defaultSortOrder: "desc",
  });

  const handleResultClick = useCallback(
    (id: string) => {
      navigate({ to: `/portal-results/${id}` });
    },
    [navigate]
  );

  const handleUnpin = useCallback(
    async (id: string) => {
      await fetchWithAuth(
        `/api/portal-results/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.portalResults.root,
      });
    },
    [fetchWithAuth, queryClient]
  );

  return (
    <Box>
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/", icon: IconName.Home },
          { label: "Pinned Results" },
        ]}
        onNavigate={(href) => navigate({ to: href })}
      />
      <Typography variant="h1" gutterBottom>
        Pinned Results
      </Typography>
      <Stack spacing={2}>
        <PaginationToolbar {...pagination.toolbarProps} />
        <PinnedResultsDataList
          query={pagination.queryParams as PortalResultsListParams}
        >
          {(response) => (
            <SyncTotal
              total={response.data?.total}
              setTotal={pagination.setTotal}
            >
              <DataResult results={{ pinned: response }}>
                {({ pinned }) => {
                  const payload = pinned as unknown as PortalResultsListPayload;
                  const results = payload.portalResults as unknown as PortalResult[];
                  if (payload.total === 0) {
                    return <EmptyResults />;
                  }
                  return (
                    <Stack spacing={1}>
                      {results.map((result) => (
                        <PinnedResultCardUI
                          key={result.id}
                          result={result}
                          onResultClick={handleResultClick}
                          onUnpin={handleUnpin}
                        />
                      ))}
                    </Stack>
                  );
                }}
              </DataResult>
            </SyncTotal>
          )}
        </PinnedResultsDataList>
      </Stack>
    </Box>
  );
};
