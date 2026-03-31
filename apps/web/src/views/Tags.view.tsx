import React, { useState, useCallback } from "react";

import type { EntityTag } from "@portalai/core/models";
import type {
  EntityTagCreateRequestBody,
  EntityTagListRequestQuery,
  EntityTagListResponsePayload,
  EntityTagUpdateRequestBody,
} from "@portalai/core/contracts";
import {
  Box,
  Button,
  Icon,
  IconName,
  PageHeader,
  Stack,
  Typography,
} from "@portalai/core/ui";
import AddIcon from "@mui/icons-material/Add";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { TagCardUI } from "../components/TagCard.component";
import { TagFormModal } from "../components/TagFormModal.component";
import { DeleteTagDialog } from "../components/DeleteTagDialog.component";
import DataResult from "../components/DataResult.component";
import { SyncTotal } from "../components/SyncTotal.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";

// ── Data list component ─────────────────────────────────────────────

interface EntityTagDataListProps {
  query: EntityTagListRequestQuery;
  children: (data: ReturnType<typeof sdk.entityTags.list>) => React.ReactNode;
}

const EntityTagDataList: React.FC<EntityTagDataListProps> = ({
  query,
  children,
}) => {
  const res = sdk.entityTags.list(query);
  return <>{children(res)}</>;
};

// ── Tags list view (pure UI) ────────────────────────────────────────

export interface TagsViewUIProps {
  onCreateTag: () => void;
  onEditTag: (tag: EntityTag) => void;
  onDeleteTag: (tag: EntityTag) => void;
}

export const TagsViewUI: React.FC<TagsViewUIProps> = ({
  onCreateTag,
  onEditTag,
  onDeleteTag,
}) => {
  const navigate = useNavigate();

  const pagination = usePagination({
    sortFields: [
      { field: "name", label: "Name" },
      { field: "created", label: "Created" },
    ],
    defaultSortBy: "name",
    defaultSortOrder: "asc",
  });

  return (
    <Box>
      <Stack spacing={4}>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "Tags" },
          ]}
          onNavigate={(href) => navigate({ to: href })}
          title="Tags"
          icon={<Icon name={IconName.Label} />}
          primaryAction={
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={onCreateTag}
            >
              Create Tag
            </Button>
          }
        />

        <PaginationToolbar {...pagination.toolbarProps} />

        <Box>
          <EntityTagDataList
            query={pagination.queryParams as EntityTagListRequestQuery}
          >
            {(listResult) => (
              <SyncTotal
                total={listResult.data?.total}
                setTotal={pagination.setTotal}
              >
                <DataResult results={{ list: listResult }}>
                  {(data) => {
                    const list =
                      data.list as unknown as EntityTagListResponsePayload;
                    if (list.entityTags.length === 0) {
                      return (
                        <Typography
                          variant="body1"
                          color="text.secondary"
                          sx={{ py: 4, textAlign: "center" }}
                        >
                          No tags found
                        </Typography>
                      );
                    }

                    return (
                      <Stack spacing={1}>
                        {list.entityTags.map((tag) => (
                          <TagCardUI
                            key={tag.id}
                            tag={tag}
                            onEdit={onEditTag}
                            onDelete={onDeleteTag}
                          />
                        ))}
                      </Stack>
                    );
                  }}
                </DataResult>
              </SyncTotal>
            )}
          </EntityTagDataList>
        </Box>
      </Stack>
    </Box>
  );
};

// ── Container (wires hooks) ─────────────────────────────────────────

export const TagsView: React.FC = () => {
  const queryClient = useQueryClient();

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<EntityTag | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingTag, setDeletingTag] = useState<EntityTag | null>(null);

  // Mutations
  const createMutation = sdk.entityTags.create();
  const updateMutation = sdk.entityTags.update(editingTag?.id ?? "");
  const deleteMutation = sdk.entityTags.delete(deletingTag?.id ?? "");

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.entityTags.root });
  }, [queryClient]);

  // Create
  const handleOpenCreate = useCallback(() => {
    setEditingTag(null);
    setFormOpen(true);
  }, []);

  // Edit
  const handleOpenEdit = useCallback((tag: EntityTag) => {
    setEditingTag(tag);
    setFormOpen(true);
  }, []);

  const handleFormClose = useCallback(() => {
    setFormOpen(false);
    setEditingTag(null);
  }, []);

  const handleFormSubmit = useCallback(
    (body: EntityTagCreateRequestBody | EntityTagUpdateRequestBody) => {
      if (editingTag) {
        updateMutation.mutate(body as EntityTagUpdateRequestBody, {
          onSuccess: () => {
            handleFormClose();
            invalidate();
          },
        });
      } else {
        createMutation.mutate(body as EntityTagCreateRequestBody, {
          onSuccess: () => {
            handleFormClose();
            invalidate();
          },
        });
      }
    },
    [editingTag, updateMutation, createMutation, handleFormClose, invalidate]
  );

  // Delete
  const handleOpenDelete = useCallback((tag: EntityTag) => {
    setDeletingTag(tag);
    setDeleteOpen(true);
  }, []);

  const handleDeleteClose = useCallback(() => {
    setDeleteOpen(false);
    setDeletingTag(null);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        handleDeleteClose();
        invalidate();
      },
    });
  }, [deleteMutation, handleDeleteClose, invalidate]);

  const activeMutation = editingTag ? updateMutation : createMutation;

  return (
    <>
      <TagsViewUI
        onCreateTag={handleOpenCreate}
        onEditTag={handleOpenEdit}
        onDeleteTag={handleOpenDelete}
      />

      <TagFormModal
        open={formOpen}
        onClose={handleFormClose}
        tag={editingTag}
        onSubmit={handleFormSubmit}
        isPending={activeMutation.isPending}
        serverError={toServerError(activeMutation.error)}
      />

      <DeleteTagDialog
        open={deleteOpen}
        onClose={handleDeleteClose}
        tag={deletingTag}
        onConfirm={handleDeleteConfirm}
        isPending={deleteMutation.isPending}
        serverError={toServerError(deleteMutation.error)}
      />
    </>
  );
};
