import React from "react";

import type { EntityRecord } from "@portalai/core/models";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";

import { Formatter } from "../utils/format.util";

// ── Types ────────────────────────────────────────────────────────────

export interface EntityRecordMetadataProps {
  record: EntityRecord;
}

// ── Helpers ──────────────────────────────────────────────────────────

interface FieldRowProps {
  label: string;
  value: React.ReactNode;
}

const FieldRow: React.FC<FieldRowProps> = ({ label, value }) => (
  <Box
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
      sx={{ minWidth: 160, flexShrink: 0 }}
    >
      {label}
    </Typography>
    <Box sx={{ flex: 1 }}>{value}</Box>
  </Box>
);

const MonoValue: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography variant="body2" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
    {children}
  </Typography>
);

const TextValue: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography variant="body2">{children}</Typography>
);

// ── Component ────────────────────────────────────────────────────────

export const EntityRecordMetadata: React.FC<EntityRecordMetadataProps> = ({
  record,
}) => {
  const syncedAt = record.syncedAt != null
    ? Formatter.datetime(record.syncedAt)
    : "—";
  const created = Formatter.datetime(record.created);
  const updated = record.updated != null
    ? Formatter.datetime(record.updated)
    : "—";

  return (
    <Stack spacing={1.5}>
      <FieldRow label="ID" value={<MonoValue>{record.id}</MonoValue>} />
      <FieldRow label="Source ID" value={<MonoValue>{record.sourceId}</MonoValue>} />
      <FieldRow label="Checksum" value={<MonoValue>{record.checksum}</MonoValue>} />
      <FieldRow label="Connector entity ID" value={<MonoValue>{record.connectorEntityId}</MonoValue>} />
      <FieldRow label="Synced at" value={<TextValue>{syncedAt}</TextValue>} />
      <FieldRow label="Created" value={<TextValue>{created}</TextValue>} />
      <FieldRow label="Updated" value={<TextValue>{updated}</TextValue>} />
    </Stack>
  );
};
