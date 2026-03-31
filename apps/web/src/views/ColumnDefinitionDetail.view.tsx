import React, { useState, useCallback } from "react";

import type {
  ColumnDefinitionGetResponsePayload,
  FieldMappingListRequestQuery,
  FieldMappingListWithConnectorEntityResponsePayload,
  FieldMappingWithConnectorEntity,
} from "@portalai/core/contracts";
import { Box, Icon, IconName, MetadataList, PageEmptyState, PageGrid, PageGridItem, PageHeader, PageSection, Stack } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import CheckIcon from "@mui/icons-material/Check";
import DeleteIcon from "@mui/icons-material/Delete";

import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";
import { ColumnDefinitionDataItem } from "../components/ColumnDefinition.component";
import { DeleteColumnDefinitionDialog } from "../components/DeleteColumnDefinitionDialog.component";
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

  const deleteMutation = sdk.columnDefinitions.delete(columnDefinitionId);
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
                    secondaryActions={[
                      { label: "Delete", icon: <DeleteIcon />, onClick: () => setDeleteDialogOpen(true), color: "error" },
                    ]}
                  >
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip
                        label={cd.type}
                        size="small"
                        color={TYPE_COLOR[cd.type] ?? "default"}
                        variant="outlined"
                      />
                      {cd.required && (
                        <Chip label="Required" size="small" color="error" />
                      )}
                    </Stack>
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
                      <PageSection title="Field Mappings" icon={<Icon name={IconName.Link} />}>
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
}

const FieldMappingTable: React.FC<FieldMappingTableProps> = ({
  fieldMappings,
}) => (
  <TableContainer>
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Source Field</TableCell>
          <TableCell>Connector Entity</TableCell>
          <TableCell>Primary Key</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {fieldMappings.map((fm) => (
          <TableRow key={fm.id}>
            <TableCell>{fm.sourceField}</TableCell>
            <TableCell>
              {fm.connectorEntity ? (
                <Link
                  to="/entities/$entityId"
                  params={{ entityId: fm.connectorEntity.id }}
                >
                  {fm.connectorEntity.label}
                </Link>
              ) : (
                fm.connectorEntityId
              )}
            </TableCell>
            <TableCell>
              {fm.isPrimaryKey && <CheckIcon fontSize="small" />}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </TableContainer>
);
