import React, { useState, useCallback } from "react";

import {
  type EntityGroupGetResponsePayload,
  type EntityGroupMemberOverlapResponsePayload,
  type EntityGroupMemberCreateRequestBody,
  type EntityGroupUpdateRequestBody,
} from "@portalai/core/contracts";
import {
  Box,
  DataTable,
  Icon,
  IconName,
  MetadataList,
  PageHeader,
  PageSection,
  Stack,
  Typography,
  AsyncSearchableSelect,
} from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import type { DataTableColumn } from "@portalai/core/ui";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarOutline";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import DataResult from "../components/DataResult.component";
import { DeleteEntityGroupDialog } from "../components/DeleteEntityGroupDialog.component";
import { EditEntityGroupDialog } from "../components/EditEntityGroupDialog.component";
import { FormAlert } from "../components/FormAlert.component";
import { sdk, queryKeys } from "../api/sdk";
import {
  useAuthFetch,
  toServerError,
  type ServerError,
} from "../utils/api.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import type { ApiSuccessResponse } from "@portalai/core/contracts";

// ── Overlap preview ─────────────────────────────────────────────────

interface OverlapPreviewProps {
  overlap: EntityGroupMemberOverlapResponsePayload | null;
  isLoading: boolean;
}

export const OverlapPreview: React.FC<OverlapPreviewProps> = ({
  overlap,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <Typography variant="body2" color="text.secondary">
        Checking overlap…
      </Typography>
    );
  }

  if (!overlap) return null;

  const pct = overlap.overlapPercentage;
  const color = pct < 5 ? "error" : pct < 50 ? "warning" : undefined;

  return (
    <Box
      data-testid="overlap-preview"
      sx={{
        p: 2,
        borderRadius: 1,
        ...(color === "error" && {
          bgcolor: "error.light",
          color: "error.contrastText",
        }),
        ...(color === "warning" && {
          bgcolor: "warning.light",
          color: "warning.contrastText",
        }),
        ...(!color && { bgcolor: "grey.100" }),
      }}
    >
      <Typography variant="h4" data-testid="overlap-percentage">
        {Math.round(pct)}% overlap
      </Typography>
      <Typography variant="body2" data-testid="overlap-counts">
        {overlap.matchingRecordCount} of {overlap.sourceRecordCount} source
        records match {overlap.matchingRecordCount} of{" "}
        {overlap.targetRecordCount} target records
      </Typography>
    </Box>
  );
};

// ── Add member dialog ───────────────────────────────────────────────

interface AddMemberDialogProps {
  open: boolean;
  onClose: () => void;
  onSearchEntities: (query: string) => Promise<SelectOption[]>;
  onSearchFieldMappings: (query: string) => Promise<SelectOption[]>;
  selectedEntityId: string | null;
  onEntityChange: (value: string | null) => void;
  selectedFieldMappingId: string | null;
  onFieldMappingChange: (value: string | null) => void;
  isPrimary: boolean;
  onPrimaryChange: (checked: boolean) => void;
  overlap: EntityGroupMemberOverlapResponsePayload | null;
  overlapLoading: boolean;
  onAddMember: () => void;
  isAdding: boolean;
  serverError?: ServerError | null;
}

export const AddMemberDialog: React.FC<AddMemberDialogProps> = ({
  open,
  onClose,
  onSearchEntities,
  onSearchFieldMappings,
  selectedEntityId,
  onEntityChange,
  selectedFieldMappingId,
  onFieldMappingChange,
  isPrimary,
  onPrimaryChange,
  overlap,
  overlapLoading,
  onAddMember,
  isAdding,
  serverError,
}) => {
  const addDisabled = !selectedEntityId || !selectedFieldMappingId || isAdding;
  const entityInputRef = useDialogAutoFocus(open);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!addDisabled) onAddMember();
        }}
      >
        <DialogTitle>Add Member</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <AsyncSearchableSelect
              inputRef={entityInputRef}
              value={selectedEntityId}
              onChange={onEntityChange}
              onSearch={onSearchEntities}
              label="Connector Entity"
              placeholder="Search entities…"
            />
            <AsyncSearchableSelect
              value={selectedFieldMappingId}
              onChange={onFieldMappingChange}
              onSearch={onSearchFieldMappings}
              label="Link Field Mapping"
              placeholder="Search field mappings…"
              disabled={!selectedEntityId}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={isPrimary}
                  onChange={(e) => onPrimaryChange(e.target.checked)}
                />
              }
              label="Primary member"
            />
            <OverlapPreview overlap={overlap} isLoading={overlapLoading} />
            <FormAlert serverError={serverError ?? null} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={onClose} disabled={isAdding}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="contained"
            onClick={() => {
              if (!addDisabled) onAddMember();
            }}
            disabled={addDisabled}
          >
            Submit
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

// ── Pure UI ──────────────────────────────────────────────────────────

export interface EntityGroupDetailViewUIProps {
  group: EntityGroupGetResponsePayload["entityGroup"];
  onUpdateGroup: (body: EntityGroupUpdateRequestBody) => void;
  onDeleteGroup: () => void;
  onPromoteMember: (memberId: string) => void;
  onDemoteMember: (memberId: string) => void;
  onRemoveMember: (memberId: string) => void;
  // Edit group dialog
  editOpen: boolean;
  onOpenEdit: () => void;
  onCloseEdit: () => void;
  editServerError: ServerError | null;
  // Add member dialog
  addMemberOpen: boolean;
  onOpenAddMember: () => void;
  onCloseAddMember: () => void;
  onSearchEntities: (query: string) => Promise<SelectOption[]>;
  onSearchFieldMappings: (query: string) => Promise<SelectOption[]>;
  selectedEntityId: string | null;
  onEntityChange: (value: string | null) => void;
  selectedFieldMappingId: string | null;
  onFieldMappingChange: (value: string | null) => void;
  addMemberIsPrimary: boolean;
  onAddMemberPrimaryChange: (checked: boolean) => void;
  overlap: EntityGroupMemberOverlapResponsePayload | null;
  overlapLoading: boolean;
  onAddMember: () => void;
  isAddingMember: boolean;
  addMemberServerError?: ServerError | null;
  isUpdatingGroup?: boolean;
  isDeletingGroup?: boolean;
  deleteServerError?: ServerError | null;
  deleteImpact?: { entityGroupMembers: number } | null;
  isLoadingDeleteImpact?: boolean;
  onDeleteDialogOpenChange?: (open: boolean) => void;
}

export const EntityGroupDetailViewUI: React.FC<
  EntityGroupDetailViewUIProps
> = ({
  group,
  onUpdateGroup,
  onDeleteGroup,
  onPromoteMember,
  onDemoteMember,
  onRemoveMember,
  editOpen,
  onOpenEdit,
  onCloseEdit,
  editServerError,
  addMemberOpen,
  onOpenAddMember,
  onCloseAddMember,
  onSearchEntities,
  onSearchFieldMappings,
  selectedEntityId,
  onEntityChange,
  selectedFieldMappingId,
  onFieldMappingChange,
  addMemberIsPrimary,
  onAddMemberPrimaryChange,
  overlap,
  overlapLoading,
  onAddMember,
  isAddingMember,
  addMemberServerError,
  isUpdatingGroup,
  isDeletingGroup,
  deleteServerError,
  deleteImpact,
  isLoadingDeleteImpact,
  onDeleteDialogOpenChange,
}) => {
  const navigate = useNavigate();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [removeDialogMemberId, setRemoveDialogMemberId] = useState<
    string | null
  >(null);

  const openDeleteDialog = () => {
    setDeleteDialogOpen(true);
    onDeleteDialogOpenChange?.(true);
  };
  const closeDeleteDialog = () => {
    setDeleteDialogOpen(false);
    onDeleteDialogOpenChange?.(false);
  };

  const handleConfirmDelete = () => {
    closeDeleteDialog();
    onDeleteGroup();
  };

  const handleConfirmRemove = () => {
    if (removeDialogMemberId) {
      onRemoveMember(removeDialogMemberId);
    }
    setRemoveDialogMemberId(null);
  };

  const membersColumns: DataTableColumn[] = [
    {
      key: "connectorEntityLabel",
      label: "Entity Label",
    },
    {
      key: "linkFieldMappingSourceField",
      label: "Link Field",
    },
    {
      key: "isPrimary",
      label: "Primary",
      render: (_value, row) => (
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            if (row.isPrimary) onDemoteMember(row.id as string);
            else onPromoteMember(row.id as string);
          }}
          aria-label={row.isPrimary ? "Remove as primary" : "Set as primary"}
        >
          {row.isPrimary ? <StarIcon color="primary" /> : <StarOutlineIcon />}
        </IconButton>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (_value, row) => (
        <IconButton
          size="small"
          color="error"
          onClick={(e) => {
            e.stopPropagation();
            setRemoveDialogMemberId(row.id as string);
          }}
          aria-label="Remove member"
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
      ),
    },
  ];

  return (
    <Box>
      <Stack spacing={4}>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "Entity Groups", href: "/entity-groups" },
            { label: group.name },
          ]}
          onNavigate={(href) => navigate({ to: href })}
          title={group.name}
          icon={<Icon name={IconName.Hub} />}
          primaryAction={
            <Button
              variant="contained"
              startIcon={<EditIcon />}
              onClick={onOpenEdit}
              disabled={isUpdatingGroup}
            >
              Edit
            </Button>
          }
          secondaryActions={[
            {
              label: "Delete",
              icon: <DeleteIcon />,
              onClick: openDeleteDialog,
              color: "error",
              disabled: isDeletingGroup,
            },
          ]}
        >
          <MetadataList
            size="medium"
            items={[
              {
                label: "Description",
                value: group.description ?? "",
                hidden: !group.description,
              },
            ]}
          />
        </PageHeader>

        {/* Members table */}
        <PageSection
          title="Members"
          icon={<Icon name={IconName.Person} />}
          primaryAction={
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={onOpenAddMember}
            >
              Add Member
            </Button>
          }
        >
          <DataTable
            columns={membersColumns}
            rows={group.members.map(
              (m) => ({ ...m }) as Record<string, unknown>
            )}
            emptyMessage="No members yet"
            onRowClick={(row) =>
              navigate({
                to: "/entities/$entityId",
                params: { entityId: row.connectorEntityId as string },
              })
            }
          />
        </PageSection>
      </Stack>

      {/* Add member dialog */}
      <AddMemberDialog
        open={addMemberOpen}
        onClose={onCloseAddMember}
        onSearchEntities={onSearchEntities}
        onSearchFieldMappings={onSearchFieldMappings}
        selectedEntityId={selectedEntityId}
        onEntityChange={onEntityChange}
        selectedFieldMappingId={selectedFieldMappingId}
        onFieldMappingChange={onFieldMappingChange}
        isPrimary={addMemberIsPrimary}
        onPrimaryChange={onAddMemberPrimaryChange}
        overlap={overlap}
        overlapLoading={overlapLoading}
        onAddMember={onAddMember}
        isAdding={isAddingMember}
        serverError={addMemberServerError}
      />

      {/* Edit group dialog */}
      <EditEntityGroupDialog
        open={editOpen}
        onClose={onCloseEdit}
        group={group}
        onSubmit={onUpdateGroup}
        isPending={!!isUpdatingGroup}
        serverError={editServerError}
      />

      {/* Delete group confirmation */}
      <DeleteEntityGroupDialog
        open={deleteDialogOpen}
        onClose={closeDeleteDialog}
        entityGroupName={group.name}
        onConfirm={handleConfirmDelete}
        isPending={isDeletingGroup}
        impact={deleteImpact ?? null}
        isLoadingImpact={isLoadingDeleteImpact}
        serverError={deleteServerError ?? null}
      />

      {/* Remove member confirmation */}
      <Dialog
        open={!!removeDialogMemberId}
        onClose={() => setRemoveDialogMemberId(null)}
      >
        <DialogTitle>Remove Member</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to remove this member from the group?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveDialogMemberId(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleConfirmRemove}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// ── Container (wires hooks) ─────────────────────────────────────────

interface EntityGroupDetailViewProps {
  entityGroupId: string;
}

export const EntityGroupDetailView: React.FC<EntityGroupDetailViewProps> = ({
  entityGroupId,
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { fetchWithAuth } = useAuthFetch();

  // Fetch group
  const groupResult = sdk.entityGroups.get(entityGroupId);

  // Mutations
  const updateMutation = sdk.entityGroups.update(entityGroupId);
  const deleteMutation = sdk.entityGroups.delete(entityGroupId);
  const addMemberMutation = sdk.entityGroups.addMember(entityGroupId);

  // Delete impact - the dialog state is inside the UI, but we track it here for the query
  const [deleteDialogOpenForImpact, setDeleteDialogOpenForImpact] =
    useState(false);
  const impactQuery = sdk.entityGroups.impact(entityGroupId, {
    enabled: deleteDialogOpenForImpact,
  });

  // Edit group dialog state
  const [editOpen, setEditOpen] = useState(false);

  // Add member dialog state
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedFieldMappingId, setSelectedFieldMappingId] = useState<
    string | null
  >(null);
  const [addMemberIsPrimary, setAddMemberIsPrimary] = useState(false);
  const [overlap, setOverlap] =
    useState<EntityGroupMemberOverlapResponsePayload | null>(null);
  const [overlapLoading, setOverlapLoading] = useState(false);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.entityGroups.root });
    queryClient.invalidateQueries({
      queryKey: queryKeys.entityGroups.get(entityGroupId),
    });
  }, [queryClient, entityGroupId]);

  const fetchOverlap = useCallback(
    async (entityId: string, fieldMappingId: string) => {
      setOverlapLoading(true);
      const params = new URLSearchParams({
        targetConnectorEntityId: entityId,
        targetLinkFieldMappingId: fieldMappingId,
      });
      try {
        const res = await fetchWithAuth<
          ApiSuccessResponse<EntityGroupMemberOverlapResponsePayload>
        >(
          `/api/entity-groups/${encodeURIComponent(entityGroupId)}/members/overlap?${params.toString()}`
        );
        setOverlap(res.payload);
      } catch {
        setOverlap(null);
      } finally {
        setOverlapLoading(false);
      }
    },
    [fetchWithAuth, entityGroupId]
  );

  const handleEntityChange = useCallback((value: string | null) => {
    setSelectedEntityId(value);
    setSelectedFieldMappingId(null);
    setOverlap(null);
  }, []);

  const handleFieldMappingChange = useCallback(
    (value: string | null) => {
      setSelectedFieldMappingId(value);
      if (value && selectedEntityId) {
        fetchOverlap(selectedEntityId, value);
      } else {
        setOverlap(null);
      }
    },
    [selectedEntityId, fetchOverlap]
  );

  const { onSearch: handleSearchEntities } = sdk.connectorEntities.search();

  const fieldMappingDefaultParams = React.useMemo(
    () =>
      selectedEntityId
        ? { connectorEntityId: selectedEntityId, limit: "100" }
        : undefined,
    [selectedEntityId]
  );
  const { onSearch: fieldMappingSearch } =
    sdk.fieldMappings.searchWithColumnDefinition({
      defaultParams: fieldMappingDefaultParams,
    });
  const handleSearchFieldMappings = useCallback(
    async (query: string): Promise<SelectOption[]> => {
      if (!selectedEntityId) return [];
      return fieldMappingSearch(query);
    },
    [selectedEntityId, fieldMappingSearch]
  );

  const handleUpdateGroup = useCallback(
    (body: EntityGroupUpdateRequestBody) => {
      updateMutation.mutate(body, {
        onSuccess: () => {
          setEditOpen(false);
          invalidate();
        },
      });
    },
    [updateMutation, invalidate]
  );

  const handleDeleteGroup = useCallback(() => {
    deleteMutation.mutate(undefined as unknown as void, {
      onSuccess: () => {
        invalidate();
        navigate({ to: "/entity-groups" });
      },
    });
  }, [deleteMutation, invalidate, navigate]);

  const handlePromoteMember = useCallback(
    async (memberId: string) => {
      await fetchWithAuth(
        `/api/entity-groups/${encodeURIComponent(entityGroupId)}/members/${encodeURIComponent(memberId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ isPrimary: true }),
        }
      );
      invalidate();
    },
    [fetchWithAuth, entityGroupId, invalidate]
  );

  const handleDemoteMember = useCallback(
    async (memberId: string) => {
      await fetchWithAuth(
        `/api/entity-groups/${encodeURIComponent(entityGroupId)}/members/${encodeURIComponent(memberId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ isPrimary: false }),
        }
      );
      invalidate();
    },
    [fetchWithAuth, entityGroupId, invalidate]
  );

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
      await fetchWithAuth(
        `/api/entity-groups/${encodeURIComponent(entityGroupId)}/members/${encodeURIComponent(memberId)}`,
        { method: "DELETE" }
      );
      invalidate();
    },
    [fetchWithAuth, entityGroupId, invalidate]
  );

  const resetAddMemberForm = useCallback(() => {
    setSelectedEntityId(null);
    setSelectedFieldMappingId(null);
    setAddMemberIsPrimary(false);
    setOverlap(null);
  }, []);

  const handleCloseAddMember = useCallback(() => {
    setAddMemberOpen(false);
    resetAddMemberForm();
  }, [resetAddMemberForm]);

  const handleAddMember = useCallback(() => {
    if (!selectedEntityId || !selectedFieldMappingId) return;
    const body: EntityGroupMemberCreateRequestBody = {
      connectorEntityId: selectedEntityId,
      linkFieldMappingId: selectedFieldMappingId,
      isPrimary: addMemberIsPrimary,
    };
    addMemberMutation.mutate(body, {
      onSuccess: () => {
        handleCloseAddMember();
        invalidate();
      },
    });
  }, [
    selectedEntityId,
    selectedFieldMappingId,
    addMemberIsPrimary,
    addMemberMutation,
    handleCloseAddMember,
    invalidate,
  ]);

  return (
    <DataResult
      results={{ group: groupResult }}
      data-testid="entity-group-detail"
    >
      {(data) => {
        const payload = data.group as unknown as EntityGroupGetResponsePayload;
        return (
          <EntityGroupDetailViewUI
            group={payload.entityGroup}
            onUpdateGroup={handleUpdateGroup}
            onDeleteGroup={handleDeleteGroup}
            onPromoteMember={handlePromoteMember}
            onDemoteMember={handleDemoteMember}
            onRemoveMember={handleRemoveMember}
            editOpen={editOpen}
            onOpenEdit={() => setEditOpen(true)}
            onCloseEdit={() => setEditOpen(false)}
            editServerError={toServerError(updateMutation.error)}
            addMemberOpen={addMemberOpen}
            onOpenAddMember={() => setAddMemberOpen(true)}
            onCloseAddMember={handleCloseAddMember}
            onSearchEntities={handleSearchEntities}
            onSearchFieldMappings={handleSearchFieldMappings}
            selectedEntityId={selectedEntityId}
            onEntityChange={handleEntityChange}
            selectedFieldMappingId={selectedFieldMappingId}
            onFieldMappingChange={handleFieldMappingChange}
            addMemberIsPrimary={addMemberIsPrimary}
            onAddMemberPrimaryChange={setAddMemberIsPrimary}
            overlap={overlap}
            overlapLoading={overlapLoading}
            onAddMember={handleAddMember}
            isAddingMember={addMemberMutation.isPending}
            addMemberServerError={toServerError(addMemberMutation.error)}
            isUpdatingGroup={updateMutation.isPending}
            isDeletingGroup={deleteMutation.isPending}
            deleteServerError={toServerError(deleteMutation.error)}
            deleteImpact={impactQuery.data ?? null}
            isLoadingDeleteImpact={
              impactQuery.isLoading && deleteDialogOpenForImpact
            }
            onDeleteDialogOpenChange={setDeleteDialogOpenForImpact}
          />
        );
      }}
    </DataResult>
  );
};
