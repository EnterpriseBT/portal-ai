import React from "react";

import type { EntityRecord } from "@portalai/core/models";
import { MetadataList, Stack, Typography } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";

import { Formatter } from "../utils/format.util";

// ── Types ────────────────────────────────────────────────────────────

export interface EntityRecordMetadataProps {
  record: EntityRecord;
}

// ── Component ────────────────────────────────────────────────────────

export const EntityRecordMetadata: React.FC<EntityRecordMetadataProps> = ({
  record,
}) => {
  const syncedAt =
    record.syncedAt != null ? Formatter.datetime(record.syncedAt) : "—";
  const created = Formatter.datetime(record.created);
  const updated =
    record.updated != null ? Formatter.datetime(record.updated) : "—";

  return (
    <Stack spacing={1}>
      <MetadataList
        items={[
          { label: "ID", value: record.id, variant: "mono" },
          { label: "Source ID", value: record.sourceId, variant: "mono" },
          { label: "Checksum", value: record.checksum, variant: "mono" },
          {
            label: "Connector entity ID",
            value: record.connectorEntityId,
            variant: "mono",
          },
          { label: "Origin", value: record.origin, variant: "chip" },
          {
            label: "Valid",
            value: (
              <Chip
                label={record.isValid ? "Valid" : "Invalid"}
                color={record.isValid ? "success" : "error"}
                size="small"
                variant="outlined"
              />
            ),
            variant: "chip",
          },
          { label: "Synced at", value: syncedAt },
          { label: "Created", value: created },
          { label: "Updated", value: updated },
        ]}
      />

      {record.validationErrors && record.validationErrors.length > 0 && (
        <Alert severity="error">
          <Typography variant="body2" sx={{ fontWeight: "bold", mb: 0.5 }}>
            Validation Errors
          </Typography>
          {record.validationErrors.map((err, i) => (
            <Typography key={i} variant="body2">
              {err.field}: {err.error}
            </Typography>
          ))}
        </Alert>
      )}
    </Stack>
  );
};
