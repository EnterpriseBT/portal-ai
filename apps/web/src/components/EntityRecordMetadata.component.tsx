import React from "react";

import type { EntityRecord } from "@portalai/core/models";
import { MetadataList } from "@portalai/core/ui";

import { Formatter } from "../utils/format.util";

// ── Types ────────────────────────────────────────────────────────────

export interface EntityRecordMetadataProps {
  record: EntityRecord;
}

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
    <MetadataList
      items={[
        { label: "ID", value: record.id, variant: "mono" },
        { label: "Source ID", value: record.sourceId, variant: "mono" },
        { label: "Checksum", value: record.checksum, variant: "mono" },
        { label: "Connector entity ID", value: record.connectorEntityId, variant: "mono" },
        { label: "Synced at", value: syncedAt },
        { label: "Created", value: created },
        { label: "Updated", value: updated },
      ]}
    />
  );
};
