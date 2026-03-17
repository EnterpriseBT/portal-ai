import React from "react";

import { Box, Stack, Typography, TextInput, Divider } from "@portalai/core/ui";

import type { Recommendations } from "./utils/upload-workflow.util";

// --- Types ---

interface ReviewStepProps {
  recommendations: Recommendations;
  onConnectorNameChange: (name: string) => void;
}

// --- Component ---

export const ReviewStep: React.FC<ReviewStepProps> = ({
  recommendations,
  onConnectorNameChange,
}) => {
  const { connectorInstance, entities } = recommendations;

  const totalColumns = entities.reduce((sum, e) => sum + e.columns.length, 0);
  const newColumns = entities.reduce(
    (sum, e) => sum + e.columns.filter((c) => c.action === "create_new").length,
    0
  );
  const matchedColumns = totalColumns - newColumns;

  return (
    <Stack spacing={3}>
      <Typography variant="body1">
        Review the import configuration before confirming.
      </Typography>

      {/* Connector Instance */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Connector Instance
        </Typography>
        <TextInput
          label="Name"
          value={connectorInstance.name}
          onChange={(e) => onConnectorNameChange(e.target.value)}
          size="small"
          fullWidth
        />
      </Box>

      <Divider />

      {/* Summary */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Summary
        </Typography>
        <Stack spacing={0.5}>
          <Typography variant="body2">Entities: {entities.length}</Typography>
          <Typography variant="body2">
            Total columns: {totalColumns} ({matchedColumns} matched,{" "}
            {newColumns} new)
          </Typography>
        </Stack>
      </Box>

      <Divider />

      {/* Per-entity detail */}
      {entities.map((entity, index) => (
        <Box key={index}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {entity.connectorEntity.label} ({entity.connectorEntity.key})
          </Typography>
          <Stack spacing={0.5} sx={{ pl: 2 }}>
            {entity.columns.map((col, colIdx) => (
              <Stack
                key={colIdx}
                direction="row"
                spacing={2}
                alignItems="center"
                sx={{ flexWrap: "wrap", rowGap: 0.5 }}
              >
                <Typography
                  variant="body2"
                  sx={{ minWidth: 120, flexShrink: 0 }}
                >
                  {col.sourceField}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  →
                </Typography>
                <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                  {col.recommended.key} ({col.recommended.type})
                </Typography>
                <Typography
                  variant="caption"
                  color={
                    col.action === "match_existing"
                      ? "success.main"
                      : "info.main"
                  }
                >
                  {col.action === "match_existing" ? "match" : "new"}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
};
