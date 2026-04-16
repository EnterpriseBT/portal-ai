import React from "react";

import { UseQueryResult } from "@tanstack/react-query";
import type {
  ConnectorEntityListRequestQuery,
  ConnectorEntityListWithMappingsResponsePayload,
  ConnectorEntityWithMappings,
  FieldMappingWithColumnDefinition,
} from "@portalai/core/contracts";
import {
  Box,
  Card,
  CardContent,
  DataTable,
  type DataTableColumn,
  Stack,
  Typography,
} from "@portalai/core/ui";
import CheckIcon from "@mui/icons-material/Check";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import IconButton from "@mui/material/IconButton";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { Link } from "@tanstack/react-router";

import { sdk } from "../api/sdk";
import { ApiError } from "../utils";

// ── Data component ──────────────────────────────────────────────────

export interface ConnectorEntityDataListProps {
  query: ConnectorEntityListRequestQuery;
  children: (
    data: UseQueryResult<
      ConnectorEntityListWithMappingsResponsePayload,
      ApiError
    >
  ) => React.ReactNode;
}

export const ConnectorEntityDataList = (
  props: ConnectorEntityDataListProps
) => {
  const res = sdk.connectorEntities.list(props.query);
  return props.children(
    res as UseQueryResult<
      ConnectorEntityListWithMappingsResponsePayload,
      ApiError
    >
  );
};

// ── Field Mapping Table ─────────────────────────────────────────────

export interface FieldMappingTableUIProps {
  fieldMappings: FieldMappingWithColumnDefinition[];
}

const fieldMappingColumns: DataTableColumn[] = [
  { key: "normalizedKey", label: "Key" },
  { key: "type", label: "Type" },
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
  { key: "sourceField", label: "Source Field" },
];

export const FieldMappingTableUI: React.FC<FieldMappingTableUIProps> = ({
  fieldMappings,
}) => {
  const rows = fieldMappings.map((fm) => ({
    id: fm.id,
    normalizedKey: fm.normalizedKey,
    type: fm.columnDefinition?.type ?? null,
    isPrimaryKey: fm.isPrimaryKey,
    required: fm.required,
    sourceField: fm.sourceField,
  }));

  return (
    <DataTable
      columns={fieldMappingColumns}
      rows={rows}
      emptyMessage="No field mappings"
    />
  );
};

// ── Entity Card ─────────────────────────────────────────────────────

export interface ConnectorEntityCardUIProps {
  connectorEntity: ConnectorEntityWithMappings;
}

export const ConnectorEntityCardUI: React.FC<ConnectorEntityCardUIProps> = ({
  connectorEntity: entity,
}) => {
  const [expanded, setExpanded] = React.useState(false);
  const mappings = entity.fieldMappings ?? [];
  const mappingCount = mappings.length;

  return (
    <Card variant="outlined">
      <CardContent
        sx={{ cursor: "pointer", "&:last-child": { pb: 2 } }}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle1" noWrap>
                {entity.label}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                ({entity.key})
              </Typography>
              <Chip
                label={`${mappingCount} mapping${mappingCount !== 1 ? "s" : ""}`}
                size="small"
                variant="outlined"
              />
            </Stack>
          </Box>
          <IconButton size="small" aria-label={expanded ? "Collapse field mappings" : "Expand field mappings"}>
            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Stack>
      </CardContent>
      <Collapse in={expanded}>
        <Box sx={{ px: 2, pb: 2 }}>
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.5}
            sx={{ mb: 1 }}
          >
            <Link
              to="/entities/$entityId"
              params={{ entityId: entity.id }}
              onClick={(e) => e.stopPropagation()}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <OpenInNewIcon fontSize="small" />
              <Typography variant="body2">View Records</Typography>
            </Link>
          </Stack>
          <FieldMappingTableUI fieldMappings={mappings} />
        </Box>
      </Collapse>
    </Card>
  );
};
