import type {
  ColumnDefinitionGetResponsePayload,
  FieldMappingListRequestQuery,
  FieldMappingListWithConnectorEntityResponsePayload,
  FieldMappingWithConnectorEntity,
} from "@portalai/core/contracts";
import { Box, Icon, IconName, PageEmptyState, PageGrid, PageGridItem, PageHeader, PageSection, Stack, Typography } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import CheckIcon from "@mui/icons-material/Check";
import React from "react";

import { Link, useNavigate } from "@tanstack/react-router";

import { ColumnDefinitionDataItem } from "../components/ColumnDefinition.component";
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
                        <Stack spacing={1}>
                          <Typography variant="body2" color="text.secondary">
                            Key:{" "}
                            <Typography
                              component="span"
                              variant="body2"
                              sx={{ fontFamily: "monospace" }}
                            >
                              {cd.key}
                            </Typography>
                          </Typography>

                          {cd.description && (
                            <Typography variant="body2" color="text.secondary">
                              Description: {cd.description}
                            </Typography>
                          )}

                          {cd.format && (
                            <Typography variant="body2" color="text.secondary">
                              Format: {cd.format}
                            </Typography>
                          )}

                          {cd.defaultValue && (
                            <Typography variant="body2" color="text.secondary">
                              Default Value: {cd.defaultValue}
                            </Typography>
                          )}

                          {cd.enumValues && cd.enumValues.length > 0 && (
                            <Typography variant="body2" color="text.secondary">
                              Enum Values: {cd.enumValues.join(", ")}
                            </Typography>
                          )}

                          <Typography variant="body2" color="text.secondary">
                            Created: {new Date(cd.created).toLocaleString()}
                          </Typography>
                        </Stack>
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
