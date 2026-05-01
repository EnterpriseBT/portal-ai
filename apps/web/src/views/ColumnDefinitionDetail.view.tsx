import React, { useState, useCallback, useMemo } from "react";

import type {
  ColumnDefinitionGetResponsePayload,
  ColumnDefinitionUpdateRequestBody,
  FieldMappingCreateRequestBody,
  FieldMappingListRequestQuery,
  FieldMappingListWithConnectorEntityResponsePayload,
  FieldMappingWithConnectorEntity,
  FieldMappingUpdateRequestBody,
} from "@portalai/core/contracts";
import {
  Box,
  Button,
  DataTable,
  Icon,
  IconName,
  MetadataList,
  PageEmptyState,
  PageHeader,
  PageSection,
  Stack,
  useColumnConfig,
} from "@portalai/core/ui";
import type { ColumnConfig, DataTableColumn } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";
import { useStorage } from "../utils/storage.util";
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
  const [editingFieldMapping, setEditingFieldMapping] =
    useState<FieldMappingWithConnectorEntity | null>(null);
  const [deletingFieldMapping, setDeletingFieldMapping] =
    useState<FieldMappingWithConnectorEntity | null>(null);
  const [createFieldMappingOpen, setCreateFieldMappingOpen] = useState(false);

  const deleteMutation = sdk.columnDefinitions.delete(columnDefinitionId);
  const updateMutation = sdk.columnDefinitions.update(columnDefinitionId);
  const fmCreateMutation = sdk.fieldMappings.create();
  const fmUpdateMutation = sdk.fieldMappings.update(
    editingFieldMapping?.id ?? ""
  );
  const fmDeleteMutation = sdk.fieldMappings.delete(
    deletingFieldMapping?.id ?? ""
  );
  const fmImpactQuery = sdk.fieldMappings.impact(
    deletingFieldMapping?.id ?? "",
    {
      enabled: !!deletingFieldMapping,
    }
  );
  const impactQuery = sdk.columnDefinitions.impact(columnDefinitionId, {
    enabled: deleteDialogOpen,
  });

  const handleDelete = useCallback(() => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        setDeleteDialogOpen(false);
        queryClient.invalidateQueries({
          queryKey: queryKeys.columnDefinitions.root,
        });
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
          queryClient.invalidateQueries({
            queryKey: queryKeys.columnDefinitions.root,
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.columnDefinitions.get(columnDefinitionId),
          });
        },
      });
    },
    [updateMutation, queryClient, columnDefinitionId]
  );

  const { onSearch: handleSearchConnectorEntities } =
    sdk.connectorEntities.search();
  const { onSearch: handleSearchConnectorEntitiesForRefKey } =
    sdk.connectorEntities.search({
      mapItem: (ce) => ({ value: ce.key, label: `${ce.label} (${ce.key})` }),
    });

  const handleFieldMappingCreate = useCallback(
    (body: FieldMappingCreateRequestBody) => {
      fmCreateMutation.mutate(body, {
        onSuccess: () => {
          setCreateFieldMappingOpen(false);
          queryClient.invalidateQueries({
            queryKey: queryKeys.fieldMappings.root,
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.columnDefinitions.root,
          });
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
          queryClient.invalidateQueries({
            queryKey: queryKeys.fieldMappings.root,
          });
          if (body.columnDefinitionId) {
            queryClient.invalidateQueries({
              queryKey: queryKeys.columnDefinitions.root,
            });
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
        queryClient.invalidateQueries({
          queryKey: queryKeys.fieldMappings.root,
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.columnDefinitions.root,
        });
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
                        disabled={cd.system}
                        title={
                          cd.system
                            ? "System column definitions are read-only"
                            : undefined
                        }
                      >
                        Edit
                      </Button>
                    }
                    secondaryActions={
                      cd.system
                        ? []
                        : [
                          {
                            label: "Delete",
                            icon: <DeleteIcon />,
                            onClick: () => setDeleteDialogOpen(true),
                            color: "error",
                          },
                        ]
                    }
                  >
                    <MetadataList
                      direction="vertical"
                      layout="responsive"
                      items={[
                        {
                          label: "Origin",
                          value: (
                            <Box>
                              <Chip
                                label={cd.system ? "System" : "Custom"}
                                size="small"
                                color={cd.system ? "default" : "primary"}
                                variant="outlined"
                              />
                            </Box>
                          ),
                          variant: "chip",
                        },
                        {
                          label: "Type",
                          value: (
                            <Box>
                              <Chip
                                label={cd.type}
                                size="small"
                                color={TYPE_COLOR[cd.type] ?? "default"}
                                variant="outlined"
                              />
                            </Box>
                          ),
                          variant: "chip",
                        },
                        { label: "Key", value: cd.key, variant: "mono" },
                        {
                          label: "Description",
                          value: cd.description ?? "",
                          hidden: !cd.description,
                        },
                        {
                          label: "Validation Pattern",
                          value: cd.validationPattern ?? "",
                          hidden: !cd.validationPattern,
                          variant: "mono",
                        },
                        {
                          label: "Validation Message",
                          value: cd.validationMessage ?? "",
                          hidden: !cd.validationMessage,
                        },
                        {
                          label: "Canonical Format",
                          value: cd.canonicalFormat ?? "",
                          hidden: !cd.canonicalFormat,
                          variant: "mono",
                        },
                        {
                          label: "Created",
                          value: new Date(cd.created).toLocaleString(),
                        },
                      ]}
                    />
                  </PageHeader>

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
                                    onEdit={(fm) =>
                                      setEditingFieldMapping(fm)
                                    }
                                    onDelete={(fm) =>
                                      setDeletingFieldMapping(fm)
                                    }
                                  />
                                );
                              }}
                            </DataResult>
                          </SyncTotal>
                        )}
                      </FieldMappingDataList>
                    </Box>
                  </PageSection>
                  <CreateFieldMappingDialog
                    open={createFieldMappingOpen}
                    onClose={() => setCreateFieldMappingOpen(false)}
                    onSubmit={handleFieldMappingCreate}
                    onSearchConnectorEntities={handleSearchConnectorEntities}
                    onSearchConnectorEntitiesForRefKey={
                      handleSearchConnectorEntitiesForRefKey
                    }
                    isPending={fmCreateMutation.isPending}
                    serverError={toServerError(fmCreateMutation.error)}
                    columnDefinitionId={columnDefinitionId}
                    columnDefinitionLabel={cd.label}
                    columnDefinitionType={cd.type}
                  />
                  <EditFieldMappingDialog
                    open={!!editingFieldMapping}
                    onClose={() => setEditingFieldMapping(null)}
                    fieldMapping={
                      editingFieldMapping
                        ? {
                          ...editingFieldMapping,
                          columnDefinitionLabel: cd.label,
                          connectorEntityLabel:
                            editingFieldMapping.connectorEntity?.label,
                        }
                        : {
                          sourceField: "",
                          normalizedKey: "",
                          isPrimaryKey: false,
                          required: false,
                          defaultValue: null,
                          format: null,
                          enumValues: null,
                          columnDefinitionId: "",
                          columnDefinitionLabel: "",
                          connectorEntityLabel: "",
                          refNormalizedKey: null,
                          refEntityKey: null,
                        }
                    }
                    onSubmit={handleFieldMappingUpdate}
                    onSearchConnectorEntitiesForRefKey={
                      handleSearchConnectorEntitiesForRefKey
                    }
                    isPending={fmUpdateMutation.isPending}
                    serverError={toServerError(fmUpdateMutation.error)}
                    columnDefinitionType={cd.type}
                  />
                  <DeleteFieldMappingDialog
                    open={!!deletingFieldMapping}
                    onClose={() => setDeletingFieldMapping(null)}
                    fieldMappingSourceField={
                      deletingFieldMapping?.sourceField ?? ""
                    }
                    onConfirm={handleFieldMappingDelete}
                    isPending={fmDeleteMutation.isPending}
                    impact={fmImpactQuery.data ?? null}
                    isLoadingImpact={
                      fmImpactQuery.isLoading && !!deletingFieldMapping
                    }
                    serverError={toServerError(fmDeleteMutation.error)}
                  />
                  <EditColumnDefinitionDialog
                    open={editDialogOpen}
                    onClose={() => {
                      setEditDialogOpen(false);
                      setUpdateWarnings([]);
                    }}
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

  const { value: storedConfig, setValue: persistConfig } = useStorage<
    ColumnConfig[]
  >({
    key: "column-config:field-mappings",
    defaultValue: [],
  });

  const dataColumns: DataTableColumn[] = useMemo(
    () => [
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
            navigate({
              to: "/entities/$entityId",
              params: { entityId: fm.connectorEntity.id },
            });
          }
        },
      },
      { key: "normalizedKey", label: "Normalized Key" },
      {
        key: "isPrimaryKey",
        label: "Primary Key",
        render: (value) => (value ? <CheckIcon fontSize="small" /> : null),
      },
      {
        key: "required",
        label: "Required",
        render: (value) => (value ? <CheckIcon fontSize="small" /> : null),
      },
      { key: "defaultValue", label: "Default Value" },
      { key: "format", label: "Format" },
      {
        key: "enumValues",
        label: "Enum Values",
        render: (value) => (Array.isArray(value) ? value.join(", ") : null),
      },
    ],
    [fieldMappings, navigate]
  );

  const actionsColumn: DataTableColumn | null = useMemo(
    () =>
      onEdit || onDelete
        ? {
          key: "actions",
          label: "Actions",
          render: (_value: unknown, row: Record<string, unknown>) => {
            const fm = fieldMappings.find((f) => f.id === row.id);
            if (!fm) return null;
            const writeEnabled =
              fm.connectorEntity?.connectorInstance?.enabledCapabilityFlags
                ?.write === true;
            return (
              <Stack direction="row" spacing={0.5}>
                {onEdit && writeEnabled && (
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
                {onDelete && writeEnabled && (
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
        }
        : null,
    [onEdit, onDelete, fieldMappings]
  );

  const [columnConfig, setColumnConfig] = useColumnConfig(dataColumns, {
    initialValue: storedConfig.length > 0 ? storedConfig : undefined,
    onPersist: persistConfig,
  });

  const allColumns = useMemo(
    () => (actionsColumn ? [...dataColumns, actionsColumn] : dataColumns),
    [dataColumns, actionsColumn]
  );
  const fullConfig = useMemo(
    () =>
      actionsColumn
        ? [...columnConfig, { key: "actions", visible: true }]
        : columnConfig,
    [columnConfig, actionsColumn]
  );
  const handleColumnConfigChange = useCallback(
    (config: ColumnConfig[]) =>
      setColumnConfig(config.filter((c) => c.key !== "actions")),
    [setColumnConfig]
  );

  return (
    <DataTable
      columns={allColumns}
      rows={fieldMappings}
      emptyMessage="No field mappings found"
      columnConfig={fullConfig}
      onColumnConfigChange={handleColumnConfigChange}
    />
  );
};
