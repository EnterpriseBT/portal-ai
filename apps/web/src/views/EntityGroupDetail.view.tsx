import React, { useState, useCallback } from "react";

import type {
  EntityGroupGetResponsePayload,
  EntityGroupMemberOverlapResponsePayload,
  EntityGroupMemberCreateRequestBody,
  EntityGroupUpdateRequestBody,
  ConnectorEntityListResponsePayload,
  FieldMappingListWithColumnDefinitionResponsePayload,
} from "@portalai/core/contracts";
import {
  Box,
  Breadcrumbs,
  DataTable,
  Stack,
  Typography,
  IconName,
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
import TextField from "@mui/material/TextField";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarOutline";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import DataResult from "../components/DataResult.component";
import { sdk, queryKeys } from "../api/sdk";
import { useAuthFetch } from "../utils/api.util";
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
}) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Member</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <AsyncSearchableSelect
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
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isAdding}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={onAddMember}
          disabled={!selectedEntityId || !selectedFieldMappingId || isAdding}
        >
          Submit
        </Button>
      </DialogActions>
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
  isUpdatingGroup?: boolean;
  isDeletingGroup?: boolean;
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
  isUpdatingGroup,
  isDeletingGroup,
}) => {
    const navigate = useNavigate();
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState(group.name);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [removeDialogMemberId, setRemoveDialogMemberId] = useState<
      string | null
    >(null);

    const handleSaveName = () => {
      if (nameValue.trim() && nameValue.trim() !== group.name) {
        onUpdateGroup({ name: nameValue.trim() });
      }
      setEditingName(false);
    };

    const handleConfirmDelete = () => {
      setDeleteDialogOpen(false);
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
        label: "Link Field"
      },
      {
        key: "isPrimary",
        label: "Primary",
        render: (_value, row) => (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              if (row.isPrimary) onDemoteMember(row.id as string)
              else onPromoteMember(row.id as string)
            }
            }
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
              setRemoveDialogMemberId(row.id as string)
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
          {/* Breadcrumbs */}
          <Box>
            <Breadcrumbs
              items={[
                { label: "Dashboard", href: "/", icon: IconName.Home },
                { label: "Entity Groups", href: "/entity-groups" },
                { label: group.name },
              ]}
              onNavigate={(href) => navigate({ to: href })}
            />
          </Box>

          {/* Header */}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "center" }}
            spacing={1}
          >
            <Box>
              {editingName ? (
                <TextField
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onBlur={handleSaveName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") {
                      setNameValue(group.name);
                      setEditingName(false);
                    }
                  }}
                  autoFocus
                  size="small"
                  slotProps={{ htmlInput: { "aria-label": "Group name" } }}
                />
              ) : (
                <Typography variant="h1">{group.name}</Typography>
              )}
              {group.description && (
                <Typography variant="body1" color="text.secondary">
                  {group.description}
                </Typography>
              )}
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                startIcon={<EditIcon />}
                onClick={() => setEditingName(true)}
                disabled={isUpdatingGroup}
              >
                Edit
              </Button>
              <Button
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => setDeleteDialogOpen(true)}
                disabled={isDeletingGroup}
              >
                Delete
              </Button>
            </Stack>
          </Stack>

          {/* Members table */}
          <Box>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="h6">
                Members
              </Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={onOpenAddMember}
              >
                Add Member
              </Button>
            </Stack>
            <DataTable
              columns={membersColumns}
              rows={group.members.map((m) => ({ ...m } as Record<string, unknown>))}
              emptyMessage="No members yet"
              onRowClick={(row) => navigate({ to: "/entities/$entityId", params: { entityId: row.connectorEntityId as string } })}
            />
          </Box>

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
        />

        {/* Delete group confirmation */}
        <Dialog
          open={deleteDialogOpen}
          onClose={() => setDeleteDialogOpen(false)}
        >
          <DialogTitle>Delete Entity Group</DialogTitle>
          <DialogContent>
            <Typography>
              Are you sure you want to delete &ldquo;{group.name}&rdquo;? This
              action cannot be undone.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button
              color="error"
              variant="contained"
              onClick={handleConfirmDelete}
            >
              Delete
            </Button>
          </DialogActions>
        </Dialog>

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
  }, [queryClient]);

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

  const handleSearchEntities = useCallback(
    async (query: string): Promise<SelectOption[]> => {
      const res = await fetchWithAuth<
        ApiSuccessResponse<ConnectorEntityListResponsePayload>
      >(`/api/connector-entities?search=${encodeURIComponent(query)}&limit=20`);
      return res.payload.connectorEntities.map((e) => ({
        value: e.id,
        label: e.label,
      }));
    },
    [fetchWithAuth]
  );

  const handleSearchFieldMappings = useCallback(
    async (query: string): Promise<SelectOption[]> => {
      if (!selectedEntityId) return [];
      const res = await fetchWithAuth<
        ApiSuccessResponse<FieldMappingListWithColumnDefinitionResponsePayload>
      >(
        `/api/field-mappings?connectorEntityId=${encodeURIComponent(selectedEntityId)}&search=${encodeURIComponent(query)}&limit=100&include=columnDefinition`
      );
      return res.payload.fieldMappings.map((fm) => ({
        value: fm.id,
        label: fm.columnDefinition?.label ?? fm.sourceField,
      }));
    },
    [fetchWithAuth, selectedEntityId]
  );

  const handleUpdateGroup = useCallback(
    (body: EntityGroupUpdateRequestBody) => {
      updateMutation.mutate(body, { onSuccess: invalidate });
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
    <DataResult results={{ group: groupResult }} data-testid="entity-group-detail">
      {(data) => {
        const payload =
          data.group as unknown as EntityGroupGetResponsePayload;
        return (
          <EntityGroupDetailViewUI
            group={payload.entityGroup}
            onUpdateGroup={handleUpdateGroup}
            onDeleteGroup={handleDeleteGroup}
            onPromoteMember={handlePromoteMember}
            onDemoteMember={handleDemoteMember}
            onRemoveMember={handleRemoveMember}
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
            isUpdatingGroup={updateMutation.isPending}
            isDeletingGroup={deleteMutation.isPending}
          />
        );
      }}
    </DataResult>
  );
};
