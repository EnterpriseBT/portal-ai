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
  CardList,
  GatedButton,
  Icon,
  IconName,
  EmptyState,
  PageHeader,
  Stack,
} from "@portalai/core/ui";
import type { ActionGate } from "@portalai/core/ui";
import AddIcon from "@mui/icons-material/Add";
import { useNavigate } from "@tanstack/react-router";

import { TagCardUI } from "../components/TagCard.component";
import { TagFormModal } from "../components/TagFormModal.component";
import { DeleteTagDialog } from "../components/DeleteTagDialog.component";
import DataResult from "../components/DataResult.component";
import { EmptyResults } from "../components/EmptyResults.component";
import { emptyListHelp } from "../utils/empty-list-help.util";
import { SyncTotal } from "../components/SyncTotal.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";
import { useCreateGate } from "../utils/use-create-gate.util";
import { tagCatalogChangeKeys } from "../utils/tag-invalidation.util";

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
  /** How Create renders for this caller (#689). */
  createGate: ActionGate;
}

export const TagsViewUI: React.FC<TagsViewUIProps> = ({
  onCreateTag,
  onEditTag,
  onDeleteTag,
  createGate,
}) => {
  const navigate = useNavigate();
  const createButton =
    createGate.kind === "hide" ? undefined : (
      <GatedButton
        variant="contained"
        startIcon={<AddIcon />}
        onClick={onCreateTag}
        gate={createGate}
      >
        Create Tag
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

  return (
    <Box>
      <Stack spacing={4}>
        <PageHeader
          breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Tags" }]}
          onNavigate={(href) => navigate({ to: href })}
          title="Tags"
          icon={<Icon name={IconName.Label} />}
          primaryAction={createButton}
        />

        <PaginationToolbar {...pagination.toolbarProps} />

        <Box>
          <EntityTagDataList
            query={
              {
                ...pagination.queryParams,
                include: "usage",
              } as EntityTagListRequestQuery
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
                      data.list as unknown as EntityTagListResponsePayload;
                    if (list.entityTags.length === 0) {
                      const hasActiveFilters = pagination.isFiltered;
                      return hasActiveFilters ? (
                        <EmptyResults />
                      ) : (
                        <EmptyState
                          icon={<Icon name={IconName.Label} />}
                          title="No tags found"
                          {...emptyListHelp("tags")}
                        />
                      );
                    }

                    return (
                      <CardList aria-label="Tags">
                        {list.entityTags.map((tag) => (
                          <TagCardUI
                            key={tag.id}
                            tag={tag}
                            headingLevel={2}
                            onEdit={onEditTag}
                            onDelete={onDeleteTag}
                          />
                        ))}
                      </CardList>
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
  // #708: Create decides from the create route's own check.
  const createGate = useCreateGate("tag", "Ask for access to create tags");

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<EntityTag | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingTag, setDeletingTag] = useState<EntityTag | null>(null);

  // Mutations
  const createMutation = sdk.entityTags.create();
  const updateMutation = sdk.entityTags.update(editingTag?.id ?? "");
  const deleteMutation = sdk.entityTags.delete(deletingTag?.id ?? "");

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
        // #1070: a rename or recolour shows on every tagged object.
        updateMutation.mutate(body as EntityTagUpdateRequestBody, {
          invalidate: tagCatalogChangeKeys(),
          onSuccess: handleFormClose,
        });
      } else {
        createMutation.mutate(body as EntityTagCreateRequestBody, {
          invalidate: [queryKeys.entityTags.root],
          onSuccess: handleFormClose,
        });
      }
    },
    [editingTag, updateMutation, createMutation, handleFormClose]
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
    // #1070: a deleted tag comes off every object.
    deleteMutation.mutate(undefined, {
      invalidate: tagCatalogChangeKeys(),
      onSuccess: handleDeleteClose,
    });
  }, [deleteMutation, handleDeleteClose]);

  const activeMutation = editingTag ? updateMutation : createMutation;

  return (
    <>
      <TagsViewUI
        onCreateTag={handleOpenCreate}
        onEditTag={handleOpenEdit}
        onDeleteTag={handleOpenDelete}
        createGate={createGate}
      />

      <TagFormModal
        open={formOpen}
        onClose={() => {
          activeMutation.reset();
          handleFormClose();
        }}
        tag={editingTag}
        onSubmit={handleFormSubmit}
        isPending={activeMutation.isPending}
        serverError={toServerError(activeMutation.error)}
      />

      <DeleteTagDialog
        open={deleteOpen}
        onClose={() => {
          deleteMutation.reset();
          handleDeleteClose();
        }}
        tag={deletingTag}
        onConfirm={handleDeleteConfirm}
        isPending={deleteMutation.isPending}
        serverError={toServerError(deleteMutation.error)}
      />
    </>
  );
};
