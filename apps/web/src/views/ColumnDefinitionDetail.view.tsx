import React, { useState, useCallback } from "react";

import type {
  ColumnDefinitionGetResponsePayload,
  ColumnDefinitionUpdateRequestBody,
  FieldMappingCreateRequestBody,
  FieldMappingListRequestQuery,
  FieldMappingListWithConnectorEntityResponsePayload,
  FieldMappingWithConnectorEntity,
  FieldMappingUpdateRequestBody,
} from "@portalai/core/contracts";
import { Box, Button, DataTable, Icon, IconName, MetadataList, PageEmptyState, PageGrid, PageGridItem, PageHeader, PageSection, Stack } from "@portalai/core/ui";
import type { DataTableColumn } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { sdk, queryKeys } from "../api/sdk";
import { useColumnDefinitionSearch } from "../api/column-definitions.api";
import { useConnectorEntitySearch } from "../api/connector-entities.api";
import { useFieldMappingWithEntitySearch } from "../api/field-mappings.api";
import { toServerError } from "../utils/api.util";
import { ColumnDefinitionDataItem } from "../components/ColumnDefinition.component";
import { CreateFieldMappingDialog } from "../components/CreateFieldMappingDialog.component";
import { DeleteColumnDefinitionDialog } from "../components/DeleteColumnDefinitionDialog.component";
import { EditColumnDefinitionDialog } from "../components/EditColumnDefinitionDialog.component";
import { DeleteFieldMappingDialog } from "../components/DeleteFieldMappingDialog.component";
import { EditFieldMappingDialog } from "../components/EditFieldMappingDialog.component";
import { FieldMappingDataList } from "../components/FieldMapping.component";
import DataResult from "../components/DataResult.component";
import { SyncTotal } from "../components/SyncTotal.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";

const TYPE_COLOR: Record<
  string,
  "primary" | "secondary" | "success" | "warning" | "error" | "info" | "default"
> = {
  string: "primary",
  number: "info",
  boolean: "success",
  date: "warning",
  datetime: "warning",
  enum: "secondary",
  json: "default",
  array: "default",
  reference: "error",
  "reference-array": "error",
  currency: "info",
};

interface ColumnDefinitionDetailViewProps {
  columnDefinitionId: string;
}

export const ColumnDefinitionDetailView: React.FC<
  ColumnDefinitionDetailViewProps
> = ({ columnDefinitionId }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [updateWarnings, setUpdateWarnings] = useState<string[]>([]);
  const [editingFieldMapping, setEditingFieldMapping] = useState<FieldMappingWithConnectorEntity | null>(null);
  const [deletingFieldMapping, setDeletingFieldMapping] = useState<FieldMappingWithConnectorEntity | null>(null);
  const [createFieldMappingOpen, setCreateFieldMappingOpen] = useState(false);

  const deleteMutation = sdk.columnDefinitions.delete(columnDefinitionId);
  const updateMutation = sdk.columnDefinitions.update(columnDefinitionId);
  const fmCreateMutation = sdk.fieldMappings.create();
  const fmUpdateMutation = sdk.fieldMappings.update(editingFieldMapping?.id ?? "");
  const fmDeleteMutation = sdk.fieldMappings.delete(deletingFieldMapping?.id ?? "");
  const fmImpactQuery = sdk.fieldMappings.impact(deletingFieldMapping?.id ?? "", {
    enabled: !!deletingFieldMapping,
  });
  const impactQuery = sdk.columnDefinitions.impact(columnDefinitionId, {
    enabled: deleteDialogOpen,
  });

  const handleDelete = useCallback(() => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        setDeleteDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.columnDefinitions.root });
        navigate({ to: "/column-definitions" });
      },
    });
  }, [deleteMutation, queryClient, navigate]);

  const handleUpdate = useCallback(
    (body: ColumnDefinitionUpdateRequestBody) => {
      updateMutation.mutate(body, {
        onSuccess: (data) => {
          setUpdateWarnings(data.warnings ?? []);
          if (!data.warnings?.length) {
            setEditDialogOpen(false);
          }
          queryClient.invalidateQueries({ queryKey: queryKeys.columnDefinitions.root });
          queryClient.invalidateQueries({ queryKey: queryKeys.columnDefinitions.get(columnDefinitionId) });
        },
      });
    },
    [updateMutation, queryClient, columnDefinitionId]
  );

  const { onSearch: handleSearchColumnDefinitions } = useColumnDefinitionSearch();
  const { onSearch: handleSearchConnectorEntities } = useConnectorEntitySearch();
  const { onSearch: handleSearchConnectorEntitiesForRefKey } = useConnectorEntitySearch({
    mapItem: (ce) => ({ value: ce.key, label: `${ce.label} (${ce.key})` }),
  });
  const { onSearch: handleSearchFieldMappings } = useFieldMappingWithEntitySearch();

  const handleFieldMappingCreate = useCallback(
    (body: FieldMappingCreateRequestBody) => {
      fmCreateMutation.mutate(body, {
        onSuccess: () => {
          setCreateFieldMappingOpen(false);
          queryClient.invalidateQueries({ queryKey: queryKeys.fieldMappings.root });
          queryClient.invalidateQueries({ queryKey: queryKeys.columnDefinitions.root });
        },
      });
    },
    [fmCreateMutation, queryClient]
  );

  const handleFieldMappingUpdate = useCallback(
    (body: FieldMappingUpdateRequestBody) => {
      fmUpdateMutation.mutate(body, {
        onSuccess: () => {
          setEditingFieldMapping(null);
          queryClient.invalidateQueries({ queryKey: queryKeys.fieldMappings.root });
          if (body.columnDefinitionId) {
            queryClient.invalidateQueries({ queryKey: queryKeys.columnDefinitions.root });
          }
        },
      });
    },
    [fmUpdateMutation, queryClient]
  );

  const handleFieldMappingDelete = useCallback(() => {
    fmDeleteMutation.mutate(undefined, {
      onSuccess: () => {
        setDeletingFieldMapping(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.fieldMappings.root });
        queryClient.invalidateQueries({ queryKey: queryKeys.columnDefinitions.root });
      },
    });
  }, [fmDeleteMutation, queryClient]);

  const mappingsPagination = usePagination({
    sortFields: [
      { field: "sourceField", label: "Source Field" },
      { field: "created", label: "Created" },
    ],
    defaultSortBy: "created",
    defaultSortOrder: "asc",
  });

  return (
    <Box>
      <ColumnDefinitionDataItem id={columnDefinitionId}>
        {(itemResult) => (
          <DataResult results={{ item: itemResult }}>
            {({ item }: { item: ColumnDefinitionGetResponsePayload }) => {
              const cd = item.columnDefinition;
              return (
                <Stack spacing={4}>
                  <PageHeader
                    breadcrumbs={[
                      { label: "Dashboard", href: "/" },
                      {
                        label: "Column Definitions",
                        href: "/column-definitions",
                      },
                      { label: cd.label },
                    ]}
                    onNavigate={(href) => navigate({ to: href })}
                    title={cd.label}
                    icon={<Icon name={IconName.ViewColumn} />}
                    primaryAction={
                      <Button
                        variant="contained"
                        startIcon={<EditIcon />}
                        onClick={() => setEditDialogOpen(true)}
                      >
                        Edit
                      </Button>
                    }
                    secondaryActions={[
                      { label: "Delete", icon: <DeleteIcon />, onClick: () => setDeleteDialogOpen(true), color: "error" },
                    ]}
                  >
                    <MetadataList
                      items={[
                        {
                          label: "Type",
                          value: (
                            <Chip
                              label={cd.type}
                              size="small"
                              color={TYPE_COLOR[cd.type] ?? "default"}
                              variant="outlined"
                            />
                          ),
                          variant: "chip",
                        },
                        {
                          label: "Required",
                          value: <Chip label="Required" size="small" color="error" />,
                          variant: "chip",
                          hidden: !cd.required,
                        },
                      ]}
                    />
                  </PageHeader>



                  <PageGrid columns={{ xs: 1, lg: 2 }}>
                    {/* Details Section */}
                    <PageGridItem>
                      <PageSection title="Details" variant="outlined">
                        <MetadataList
                          items={[
                            { label: "Key", value: cd.key, variant: "mono" },
                            { label: "Description", value: cd.description ?? "", hidden: !cd.description },
                            { label: "Format", value: cd.format ?? "", hidden: !cd.format },
                            { label: "Default Value", value: cd.defaultValue ?? "", hidden: !cd.defaultValue },
                            { label: "Enum Values", value: cd.enumValues?.join(", ") ?? "", hidden: !cd.enumValues || cd.enumValues.length === 0 },
                            { label: "Created", value: new Date(cd.created).toLocaleString() },
                          ]}
                        />
                      </PageSection>
                    </PageGridItem>

                    {/* Field Mappings Section */}
                    <PageGridItem>
                      <PageSection
                        title="Field Mappings"
                        icon={<Icon name={IconName.Link} />}
                        primaryAction={
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<AddIcon />}
                            onClick={() => setCreateFieldMappingOpen(true)}
                          >
                            Create
                          </Button>
                        }
                      >
                        <PaginationToolbar {...mappingsPagination.toolbarProps} />

                        <Box sx={{ mt: 2 }}>
                          <FieldMappingDataList<FieldMappingListWithConnectorEntityResponsePayload>
                            query={
                              {
                                columnDefinitionId,
                                include: "connectorEntity",
                                ...mappingsPagination.queryParams,
                              } as FieldMappingListRequestQuery
                            }
                          >
                            {(mappingsResult) => (
                              <SyncTotal
                                total={mappingsResult.data?.total}
                                setTotal={mappingsPagination.setTotal}
                              >
                                <DataResult results={{ mappings: mappingsResult }}>
                                  {({
                                    mappings,
                                  }: {
                                    mappings: FieldMappingListWithConnectorEntityResponsePayload;
                                  }) => {
                                    if (mappings.fieldMappings.length === 0) {
                                      return (
                                        <PageEmptyState
                                          icon={<Icon name={IconName.Link} />}
                                          title="No field mappings found"
                                        />
                                      );
                                    }

                                    return (
                                      <FieldMappingTable
                                        fieldMappings={mappings.fieldMappings}
                                        onEdit={(fm) => setEditingFieldMapping(fm)}
                                        onDelete={(fm) => setDeletingFieldMapping(fm)}
                                      />
                                    );
                                  }}
                                </DataResult>
                              </SyncTotal>
                            )}
                          </FieldMappingDataList>
                        </Box>
                      </PageSection>
                    </PageGridItem>
                  </PageGrid>
                  <CreateFieldMappingDialog
                    open={createFieldMappingOpen}
                    onClose={() => setCreateFieldMappingOpen(false)}
                    onSubmit={handleFieldMappingCreate}
                    onSearchConnectorEntities={handleSearchConnectorEntities}
                    onSearchColumnDefinitions={handleSearchColumnDefinitions}
                    onSearchConnectorEntitiesForRefKey={handleSearchConnectorEntitiesForRefKey}
                    onSearchFieldMappings={handleSearchFieldMappings}
                    isPending={fmCreateMutation.isPending}
                    serverError={toServerError(fmCreateMutation.error)}
                    columnDefinitionId={columnDefinitionId}
                    columnDefinitionLabel={cd.label}
                    columnDefinitionType={cd.type}
                  />
                  <EditFieldMappingDialog
                    open={!!editingFieldMapping}
                    onClose={() => setEditingFieldMapping(null)}
                    fieldMapping={editingFieldMapping
                      ? {
                        ...editingFieldMapping,
                        columnDefinitionLabel: cd.label,
                        connectorEntityLabel: editingFieldMapping.connectorEntity?.label,
                      }
                      : {
                        sourceField: "",
                        isPrimaryKey: false,
                        columnDefinitionId: "",
                        columnDefinitionLabel: "",
                        connectorEntityLabel: "",
                        refColumnDefinitionId: null,
                        refEntityKey: null,
                        refBidirectionalFieldMappingId: null,
                      }
                    }
                    onSubmit={handleFieldMappingUpdate}
                    onSearchColumnDefinitions={handleSearchColumnDefinitions}
                    onSearchConnectorEntitiesForRefKey={handleSearchConnectorEntitiesForRefKey}
                    onSearchFieldMappings={handleSearchFieldMappings}
                    isPending={fmUpdateMutation.isPending}
                    serverError={toServerError(fmUpdateMutation.error)}
                    columnDefinitionType={cd.type}
                  />
                  <DeleteFieldMappingDialog
                    open={!!deletingFieldMapping}
                    onClose={() => setDeletingFieldMapping(null)}
                    fieldMappingSourceField={deletingFieldMapping?.sourceField ?? ""}
                    onConfirm={handleFieldMappingDelete}
                    isPending={fmDeleteMutation.isPending}
                    impact={fmImpactQuery.data ?? null}
                    isLoadingImpact={fmImpactQuery.isLoading && !!deletingFieldMapping}
                    serverError={toServerError(fmDeleteMutation.error)}
                  />
                  <EditColumnDefinitionDialog
                    open={editDialogOpen}
                    onClose={() => { setEditDialogOpen(false); setUpdateWarnings([]); }}
                    columnDefinition={cd}
                    onSubmit={handleUpdate}
                    isPending={updateMutation.isPending}
                    serverError={toServerError(updateMutation.error)}
                    warnings={updateWarnings}
                  />
                  <DeleteColumnDefinitionDialog
                    open={deleteDialogOpen}
                    onClose={() => setDeleteDialogOpen(false)}
                    columnDefinitionLabel={cd.label}
                    onConfirm={handleDelete}
                    isPending={deleteMutation.isPending}
                    impact={impactQuery.data ?? null}
                    isLoadingImpact={impactQuery.isLoading && deleteDialogOpen}
                    serverError={toServerError(deleteMutation.error)}
                  />
                </Stack>
              );
            }}
          </DataResult>
        )}
      </ColumnDefinitionDataItem>
    </Box>
  );
};

// ── Field Mapping Table ─────────────────────────────────────────────

interface FieldMappingTableProps {
  fieldMappings: FieldMappingWithConnectorEntity[];
  onEdit?: (fm: FieldMappingWithConnectorEntity) => void;
  onDelete?: (fm: FieldMappingWithConnectorEntity) => void;
}

const FieldMappingTable: React.FC<FieldMappingTableProps> = ({
  fieldMappings,
  onEdit,
  onDelete,
}) => {
  const navigate = useNavigate();

  const columns: DataTableColumn[] = [
    { key: "sourceField", label: "Source Field" },
    {
      key: "connectorEntity",
      label: "Connector Entity",
      render: (_value, row) => {
        const fm = fieldMappings.find((f) => f.id === row.id) ?? null;
        if (fm?.connectorEntity) {
          return fm.connectorEntity.label;
        }
        return row.connectorEntityId as string;
      },
      onCellClick: (_value, _col, row) => {
        const fm = fieldMappings.find((f) => f.id === row.id);
        if (fm?.connectorEntity) {
          navigate({ to: "/entities/$entityId", params: { entityId: fm.connectorEntity.id } });
        }
      },
    },
    {
      key: "isPrimaryKey",
      label: "Primary Key",
      render: (value) => (value ? <CheckIcon fontSize="small" /> : null),
    },
    ...((onEdit || onDelete)
      ? [
        {
          key: "actions",
          label: "Actions",
          render: (_value: unknown, row: Record<string, unknown>) => {
            const fm = fieldMappings.find((f) => f.id === row.id);
            if (!fm) return null;
            return (
              <Stack direction="row" spacing={0.5}>
                {onEdit && (
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(fm);
                    }}
                    aria-label="Edit field mapping"
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                )}
                {onDelete && (
                  <IconButton
                    size="small"
                    color="error"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(fm);
                    }}
                    aria-label="Delete field mapping"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            );
          },
        } as DataTableColumn,
      ]
      : []),
  ];

  return (
    <DataTable
      columns={columns}
      rows={fieldMappings.map((fm) => ({ ...fm } as Record<string, unknown>))}
      emptyMessage="No field mappings found"
    />
  );
};
