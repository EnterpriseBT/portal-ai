import React, { useState, useCallback } from "react";

import type {
  ColumnDefinitionCreateRequestBody,
  ColumnDefinitionListRequestQuery,
  ColumnDefinitionListResponsePayload,
} from "@portalai/core/contracts";
import type { ColumnDefinition } from "@portalai/core/models";
import { ColumnDataTypeEnum } from "@portalai/core/models";
import { Box, Button, Icon, IconName, PageEmptyState, PageHeader, Stack } from "@portalai/core/ui";
import AddIcon from "@mui/icons-material/Add";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import {
  ColumnDefinitionDataList,
  ColumnDefinitionCardUI,
} from "../components/ColumnDefinition.component";
import { CreateColumnDefinitionDialog } from "../components/CreateColumnDefinitionDialog.component";
import { DeleteColumnDefinitionDialog } from "../components/DeleteColumnDefinitionDialog.component";
import { EmptyResults } from "../components/EmptyResults.component";
import DataResult from "../components/DataResult.component";
import { SyncTotal } from "../components/SyncTotal.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";

const TYPE_OPTIONS = ColumnDataTypeEnum.options.map((t) => ({
  label: t,
  value: t,
}));

// ── Column definition list view (pure UI) ───────────────────────────

export interface ColumnDefinitionListViewUIProps {
  onCreateOpen: () => void;
  onDelete: (cd: ColumnDefinition) => void;
}

export const ColumnDefinitionListViewUI: React.FC<ColumnDefinitionListViewUIProps> = ({
  onCreateOpen,
  onDelete,
}) => {
  const navigate = useNavigate();

  const pagination = usePagination({
    sortFields: [
      { field: "key", label: "Key" },
      { field: "label", label: "Label" },
      { field: "type", label: "Type" },
      { field: "created", label: "Created" },
    ],
    defaultSortBy: "created",
    defaultSortOrder: "asc",
    filters: [
      {
        type: "multi-select",
        field: "type",
        label: "Type",
        options: TYPE_OPTIONS,
      },
      {
        type: "select",
        field: "system",
        label: "Origin",
        options: [
          { label: "Custom", value: "false" },
          { label: "System", value: "true" },
        ],
      },
    ],
  });

  return (
    <Box>
      <Stack spacing={4}>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "Column Definitions" },
          ]}
          onNavigate={(href) => navigate({ to: href })}
          title="Column Definitions"
          icon={<Icon name={IconName.ViewColumn} />}
          primaryAction={
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={onCreateOpen}
            >
              Create Column Definition
            </Button>
          }
        />

        <PaginationToolbar {...pagination.toolbarProps} />

        <Box>
          <ColumnDefinitionDataList
            query={pagination.queryParams as ColumnDefinitionListRequestQuery}
          >
            {(listResult) => (
              <SyncTotal
                total={listResult.data?.total}
                setTotal={pagination.setTotal}
              >
                <DataResult results={{ list: listResult }}>
                  {({
                    list,
                  }: {
                    list: ColumnDefinitionListResponsePayload;
                  }) => {
                    if (list.columnDefinitions.length === 0) {
                      const hasActiveFilters = pagination.search || Object.values(pagination.filters).some(v => v.length > 0);
                      return hasActiveFilters ? (
                        <EmptyResults />
                      ) : (
                        <PageEmptyState
                          icon={<Icon name={IconName.ViewColumn} />}
                          title="No column definitions found"
                        />
                      );
                    }

                    return (
                      <Stack spacing={1}>
                        {list.columnDefinitions.map((cd) => (
                          <ColumnDefinitionCardUI
                            key={cd.id}
                            columnDefinition={cd}
                            onClick={() =>
                              navigate({
                                to: `/column-definitions/${cd.id}`,
                              })
                            }
                            onDelete={onDelete}
                          />
                        ))}
                      </Stack>
                    );
                  }}
                </DataResult>
              </SyncTotal>
            )}
          </ColumnDefinitionDataList>
        </Box>
      </Stack>
    </Box>
  );
};

// ── Container (wires hooks) ─────────────────────────────────────────

export const ColumnDefinitionListView: React.FC = () => {
  const queryClient = useQueryClient();

  // Create
  const [createOpen, setCreateOpen] = useState(false);
  const createMutation = sdk.columnDefinitions.create();

  const handleOpenCreate = useCallback(() => {
    setCreateOpen(true);
  }, []);

  const handleCreateClose = useCallback(() => {
    setCreateOpen(false);
  }, []);

  const handleCreateSubmit = useCallback(
    (body: ColumnDefinitionCreateRequestBody) => {
      createMutation.mutate(body, {
        onSuccess: () => {
          handleCreateClose();
          queryClient.invalidateQueries({ queryKey: queryKeys.columnDefinitions.root });
        },
      });
    },
    [createMutation, handleCreateClose, queryClient]
  );

  // Delete
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingCd, setDeletingCd] = useState<ColumnDefinition | null>(null);
  const deleteMutation = sdk.columnDefinitions.delete(deletingCd?.id ?? "");
  const impactQuery = sdk.columnDefinitions.impact(deletingCd?.id ?? "", {
    enabled: deleteOpen && !!deletingCd,
  });

  const handleOpenDelete = useCallback((cd: ColumnDefinition) => {
    setDeletingCd(cd);
    setDeleteOpen(true);
  }, []);

  const handleDeleteClose = useCallback(() => {
    setDeleteOpen(false);
    setDeletingCd(null);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        handleDeleteClose();
        queryClient.invalidateQueries({ queryKey: queryKeys.columnDefinitions.root });
      },
    });
  }, [deleteMutation, handleDeleteClose, queryClient]);

  return (
    <>
      <ColumnDefinitionListViewUI
        onCreateOpen={handleOpenCreate}
        onDelete={handleOpenDelete}
      />

      <CreateColumnDefinitionDialog
        open={createOpen}
        onClose={handleCreateClose}
        onSubmit={handleCreateSubmit}
        isPending={createMutation.isPending}
        serverError={toServerError(createMutation.error)}
      />

      <DeleteColumnDefinitionDialog
        open={deleteOpen}
        onClose={handleDeleteClose}
        columnDefinitionLabel={deletingCd?.label ?? ""}
        onConfirm={handleDeleteConfirm}
        isPending={deleteMutation.isPending}
        impact={impactQuery.data ?? null}
        isLoadingImpact={impactQuery.isLoading && deleteOpen}
        serverError={toServerError(deleteMutation.error)}
      />
    </>
  );
};
