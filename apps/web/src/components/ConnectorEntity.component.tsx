import React from "react";

import { UseQueryResult } from "@tanstack/react-query";
import type {
  ConnectorEntityListRequestQuery,
  ConnectorEntityListWithMappingsResponsePayload,
  ConnectorEntityWithMappings,
  FieldMappingWithColumnDefinition,
} from "@portalai/core/contracts";
import { Box, Card, CardContent, Stack, Typography } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import CheckIcon from "@mui/icons-material/Check";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
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

export const FieldMappingTableUI: React.FC<FieldMappingTableUIProps> = ({
  fieldMappings,
}) => {
  if (fieldMappings.length === 0) {
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ py: 2, textAlign: "center" }}
      >
        No field mappings
      </Typography>
    );
  }

  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Source Field</TableCell>
            <TableCell>Label</TableCell>
            <TableCell>Key</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Required</TableCell>
            <TableCell>Primary Key</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {fieldMappings.map((fm) => (
            <TableRow key={fm.id}>
              <TableCell>{fm.sourceField}</TableCell>
              <TableCell>{fm.columnDefinition?.label ?? "—"}</TableCell>
              <TableCell>{fm.columnDefinition?.key ?? "—"}</TableCell>
              <TableCell sx={{ typography: "monospace" }}>
                {fm.columnDefinition?.type ?? "—"}
              </TableCell>
              <TableCell>
                {fm.columnDefinition?.required && (
                  <CheckIcon fontSize="small" />
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
