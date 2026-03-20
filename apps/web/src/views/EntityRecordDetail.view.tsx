import React from "react";

import type { ConnectorEntity, EntityRecord } from "@portalai/core/models";
import type {
  ColumnDefinitionSummary,
  ConnectorEntityGetResponsePayload,
  EntityRecordGetResponsePayload,
} from "@portalai/core/contracts";
import { Box, Breadcrumbs, Stack, Typography } from "@portalai/core/ui";
import { IconName } from "@portalai/core/ui";

import { useNavigate } from "@tanstack/react-router";

import { sdk } from "../api/sdk";
import DataResult from "../components/DataResult.component";
import { EntityRecordFieldValue } from "../components/EntityRecordFieldValue.component";
import { EntityRecordMetadata } from "../components/EntityRecordMetadata.component";

// ── Pure UI ──────────────────────────────────────────────────────────

export interface EntityRecordDetailViewUIProps {
  entity: ConnectorEntity;
  record: EntityRecord;
  columns: ColumnDefinitionSummary[];
}

export const EntityRecordDetailViewUI: React.FC<EntityRecordDetailViewUIProps> = ({
  entity,
  record,
  columns,
}) => {
  const navigate = useNavigate();

  return (
    <Box>
      <Stack spacing={4}>
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/", icon: IconName.Home },
            { label: "Entities", href: "/entities" },
            { label: entity.label, href: `/entities/${entity.id}` },
            { label: `Record ${record.sourceId}` },
          ]}
          onNavigate={(href) => navigate({ to: href })}
        />

        {/* Metadata */}
        <Box>
          <Typography variant="h2" sx={{ mb: 2 }}>
            Metadata
          </Typography>
          <EntityRecordMetadata record={record} />
        </Box>

        {/* Fields */}
        <Box>
          <Typography variant="h2" sx={{ mb: 2 }}>
            Fields
          </Typography>
          <Stack spacing={2}>
            {columns.map((col) => (
              <Box
                key={col.key}
                sx={{
                  display: "flex",
                  flexDirection: { xs: "column", sm: "row" },
                  gap: { xs: 0.5, sm: 2 },
                  alignItems: "flex-start",
                }}
              >
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ minWidth: 200, flexShrink: 0 }}
                >
                  {col.label}
                </Typography>
                <EntityRecordFieldValue
                  value={record.normalizedData[col.key]}
                  type={col.type}
                />
              </Box>
            ))}
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
};

// ── Container ────────────────────────────────────────────────────────

export interface EntityRecordDetailViewProps {
  entityId: string;
  recordId: string;
}

export const EntityRecordDetailView: React.FC<EntityRecordDetailViewProps> = ({
  entityId,
  recordId,
}) => {
  const entityResult = sdk.connectorEntities.get(entityId);
  const recordResult = sdk.entityRecords.get(entityId, recordId);

  return (
    <DataResult results={{ entity: entityResult, record: recordResult }}>
      {({
        entity: entityPayload,
        record: recordPayload,
      }: {
        entity: ConnectorEntityGetResponsePayload;
        record: EntityRecordGetResponsePayload;
      }) => (
        <EntityRecordDetailViewUI
          entity={entityPayload.connectorEntity}
          record={recordPayload.record}
          columns={recordPayload.columns}
        />
      )}
    </DataResult>
  );
};
