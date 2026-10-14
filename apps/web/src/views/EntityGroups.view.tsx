import React, { useState, useCallback } from "react";

import {
  type EntityGroupCreateRequestBody,
  type EntityGroupListRequestQuery,
  type EntityGroupListResponsePayload,
} from "@portalai/core/contracts";
import {
  Box,
  Icon,
  IconName,
  PageEmptyState,
  PageHeader,
  DetailCard,
  GatedButton,
  MetadataList,
  Stack,
} from "@portalai/core/ui";
import type { ActionGate, ActionSuiteItem } from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { CreateEntityGroupDialog } from "../components/CreateEntityGroupDialog.component";
import DataResult from "../components/DataResult.component";
import { DeleteEntityGroupDialog } from "../components/DeleteEntityGroupDialog.component";
import { EmptyResults } from "../components/EmptyResults.component";
import { SyncTotal } from "../components/SyncTotal.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { decideActionGate } from "../utils/action-gate.util";
import { useCreateGate } from "../utils/use-create-gate.util";
import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";

// ── Data list component ─────────────────────────────────────────────

interface EntityGroupDataListProps {
  query: EntityGroupListRequestQuery;
  children: (data: ReturnType<typeof sdk.entityGroups.list>) => React.ReactNode;
}

const EntityGroupDataList: React.FC<EntityGroupDataListProps> = ({
  query,
  children,
}) => {
  const res = sdk.entityGroups.list(query);
  return <>{children(res)}</>;
};

const dates = new DateFactory("UTC");

// ── Entity Group card ────────────────────────────────────────────────

interface EntityGroupCardProps {
  group: EntityGroupListResponsePayload["entityGroups"][number];
  onClick: () => void;
  onDelete: () => void;
}

const EntityGroupCard: React.FC<EntityGroupCardProps> = ({
  group,
  onClick,
  onDelete,
}) => {
  const actions: ActionSuiteItem[] = [
    {
      label: "Delete",
      icon: <DeleteIcon />,
      onClick: onDelete,
      color: "error" as const,
      // #689: the group's own delete.
      gate: decideActionGate({ allowed: group.capabilities.delete }),
    },
  ];

  return (
    <DetailCard title={group.name} onClick={onClick} actions={actions}>
      <MetadataList
        items={[
          {
            label: "Description",
            value: group.description ?? "",
            hidden: !group.description,
          },
          {
            label: "Members",
            value: `${group.memberCount} ${group.memberCount === 1 ? "member" : "members"}`,
          },
          {
            label: "Created",
            value: dates.format(group.created, "MM/dd/yyyy"),
          },
        ]}
      />
    </DetailCard>
  );
};

// ── Entity Groups list view (pure UI) ──────────────────────────────

export interface EntityGroupsViewUIProps {
  onCreateGroup: () => void;
  onDeleteGroup: (
    group: EntityGroupListResponsePayload["entityGroups"][number]
  ) => void;
  /** How Create renders for this caller (#689). */
  createGate: ActionGate;
}

export const EntityGroupsViewUI: React.FC<EntityGroupsViewUIProps> = ({
  onCreateGroup,
  onDeleteGroup,
  createGate,
}) => {
  const navigate = useNavigate();
  const createButton =
    createGate.kind === "hide" ? undefined : (
      <GatedButton
        variant="contained"
        startIcon={<AddIcon />}
        onClick={onCreateGroup}
        gate={createGate}
      >
        Create Group
      </GatedButton>
    );

  const pagination = usePagination({
    sortFields: [
      { field: "name", label: "Name" },
      { field: "created", label: "Created" },
    ],
    defaultSortBy: "name",
    defaultSortOrder: "asc",
  });

  const handleRowClick = (groupId: string) => {
    navigate({
      to: `/entity-groups/${groupId}`,
    });
  };

  return (
    <Box>
      <Stack spacing={4}>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "Entity Groups" },
          ]}
          onNavigate={(href) => navigate({ to: href })}
          title="Entity Groups"
          icon={<Icon name={IconName.Hub} />}
          primaryAction={createButton}
        />

        <PaginationToolbar {...pagination.toolbarProps} />

        <Box>
          <EntityGroupDataList
            query={
              {
                ...pagination.queryParams,
                include: "memberCount",
              } as EntityGroupListRequestQuery
            }
          >
            {(listResult) => (
              <SyncTotal
                total={listResult.data?.total}
                setTotal={pagination.setTotal}
              >
                <DataResult results={{ list: listResult }}>
                  {(data) => {
                    const list =
                      data.list as unknown as EntityGroupListResponsePayload;
                    if (list.entityGroups.length === 0) {
                      const hasActiveFilters =
                        pagination.search ||
                        Object.values(pagination.filters).some(
                          (v) => v.length > 0
                        );
                      return hasActiveFilters ? (
                        <EmptyResults />
                      ) : (
                        <PageEmptyState
                          icon={<Icon name={IconName.Hub} />}
                          title="No entity groups found"
                          description="Create your first entity group to get started."
                          action={createButton}
                        />
                      );
                    }

                    return (
                      <Stack spacing={1}>
                        {list.entityGroups.map((group) => (
                          <EntityGroupCard
                            key={group.id}
                            group={group}
                            onClick={() => handleRowClick(group.id)}
                            onDelete={() => onDeleteGroup(group)}
                          />
                        ))}
                      </Stack>
                    );
                  }}
                </DataResult>
              </SyncTotal>
            )}
          </EntityGroupDataList>
        </Box>
      </Stack>
    </Box>
  );
};

// ── Container (wires hooks) ─────────────────────────────────────────

export const EntityGroupsView: React.FC = () => {
  const queryClient = useQueryClient();
  // #708: Create decides from the create route's own check.
  const createGate = useCreateGate(
    "entity_group",
    "Ask for access to create entity groups"
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<
    EntityGroupListResponsePayload["entityGroups"][number] | null
  >(null);

  const createMutation = sdk.entityGroups.create();
  const deleteMutation = sdk.entityGroups.delete(deletingGroup?.id ?? "");
  const impactQuery = sdk.entityGroups.impact(deletingGroup?.id ?? "", {
    enabled: !!deletingGroup,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.entityGroups.root });
  }, [queryClient]);

  const handleOpenCreate = useCallback(() => {
    setCreateOpen(true);
  }, []);

  const handleCreateClose = useCallback(() => {
    setCreateOpen(false);
  }, []);

  const handleCreateSubmit = useCallback(
    (body: EntityGroupCreateRequestBody) => {
      createMutation.mutate(body, {
        onSuccess: () => {
          handleCreateClose();
          invalidate();
        },
      });
    },
    [createMutation, handleCreateClose, invalidate]
  );

  const handleDeleteGroup = useCallback(
    (group: EntityGroupListResponsePayload["entityGroups"][number]) => {
      setDeletingGroup(group);
    },
    []
  );

  const handleDeleteClose = useCallback(() => {
    setDeletingGroup(null);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    deleteMutation.mutate(undefined as unknown as void, {
      onSuccess: () => {
        setDeletingGroup(null);
        invalidate();
      },
    });
  }, [deleteMutation, invalidate]);

  return (
    <>
      <EntityGroupsViewUI
        onCreateGroup={handleOpenCreate}
        onDeleteGroup={handleDeleteGroup}
        createGate={createGate}
      />

      <CreateEntityGroupDialog
        open={createOpen}
        onClose={() => {
          createMutation.reset();
          handleCreateClose();
        }}
        onSubmit={handleCreateSubmit}
        isPending={createMutation.isPending}
        serverError={toServerError(createMutation.error)}
      />

      <DeleteEntityGroupDialog
        open={!!deletingGroup}
        onClose={() => {
          deleteMutation.reset();
          handleDeleteClose();
        }}
        entityGroupName={deletingGroup?.name ?? ""}
        onConfirm={handleDeleteConfirm}
        isPending={deleteMutation.isPending}
        impact={impactQuery.data ?? null}
        isLoadingImpact={impactQuery.isLoading && !!deletingGroup}
        serverError={toServerError(deleteMutation.error)}
      />
    </>
  );
};
