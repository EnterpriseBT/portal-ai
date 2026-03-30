import React from "react";

import {
  Box,
  Stack,
  Typography,
  TextInput,
  Divider,
  Button,
  CircularProgress,
  StatusMessage,
} from "@portalai/core/ui";
import type { ConfirmResponsePayload } from "@portalai/core/contracts";

import type { Recommendations } from "./utils/upload-workflow.util";

// --- Types ---

export interface ReviewStepProps {
  recommendations: Recommendations | null;
  onConnectorNameChange: (name: string) => void;
  onConfirm: () => void;
  isConfirming: boolean;
  confirmError: string | null;
  confirmResult: ConfirmResponsePayload | null;
  onDone: () => void;
  onCancel: () => void;
  isCancelling: boolean;
}

// --- Completion Summary ---

const CompletionSummary: React.FC<{
  result: ConfirmResponsePayload;
  onDone: () => void;
}> = ({ result, onDone }) => {
  return (
    <Stack spacing={3}>
      <StatusMessage
        message="Import completed successfully!"
        variant="success"
      />

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Connector Instance
        </Typography>
        <Typography variant="body2">
          {result.connectorInstanceName}
        </Typography>
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Created Entities
        </Typography>
        <Stack spacing={1}>
          {result.confirmedEntities.map((entity) => (
            <Box key={entity.connectorEntityId}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {entity.entityLabel} ({entity.entityKey})
              </Typography>
              <Stack spacing={0.5} sx={{ pl: 2, mt: 0.5 }}>
                <Typography variant="body2" color="text.secondary">
                  {entity.columnDefinitions.length} column{entity.columnDefinitions.length !== 1 ? "s" : ""} defined
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {entity.fieldMappings.length} field mapping{entity.fieldMappings.length !== 1 ? "s" : ""} created
                </Typography>
                {entity.importResult && (
                  <Typography variant="body2" color="text.secondary">
                    {entity.importResult.created} record{entity.importResult.created !== 1 ? "s" : ""} imported
                    {entity.importResult.updated > 0 && `, ${entity.importResult.updated} updated`}
                    {entity.importResult.unchanged > 0 && `, ${entity.importResult.unchanged} unchanged`}
                  </Typography>
                )}
              </Stack>
            </Box>
          ))}
        </Stack>
      </Box>

      <Divider />

      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Button onClick={onDone} variant="contained">
          Done
        </Button>
      </Box>
    </Stack>
  );
};

// --- Helpers ---

function formatColumnType(recommended: {
  type: string;
  refEntityKey?: string | null;
  refColumnKey?: string | null;
}): string {
  if (recommended.type !== "reference") return recommended.type;
  if (recommended.refEntityKey && recommended.refColumnKey) {
    return `reference → ${recommended.refEntityKey}.${recommended.refColumnKey}`;
  }
  if (recommended.refEntityKey) {
    return `reference → ${recommended.refEntityKey}`;
  }
  return "reference";
}

// --- Review Form ---

const ReviewForm: React.FC<{
  recommendations: Recommendations;
  onConnectorNameChange: (name: string) => void;
  onConfirm: () => void;
  isConfirming: boolean;
  confirmError: string | null;
  onCancel: () => void;
  isCancelling: boolean;
}> = ({
  recommendations,
  onConnectorNameChange,
  onConfirm,
  isConfirming,
  confirmError,
  onCancel,
  isCancelling,
}) => {
  const { connectorInstance, entities } = recommendations;

  const totalColumns = entities.reduce((sum, e) => sum + e.columns.length, 0);
  const newColumns = entities.reduce(
    (sum, e) => sum + e.columns.filter((c) => c.action === "create_new").length,
    0,
  );
  const matchedColumns = totalColumns - newColumns;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!isConfirming && !isCancelling) onConfirm();
      }}
    >
      <Stack spacing={3}>
        <Typography variant="body1">
          Review the import configuration before confirming.
        </Typography>

        {confirmError && (
          <StatusMessage message={confirmError} variant="error" />
        )}

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
            disabled={isConfirming}
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
                    {col.recommended.key} ({formatColumnType(col.recommended)})
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

        <Divider />

        {/* Actions */}
        <Stack direction="row" justifyContent="space-between">
          <Button
            type="button"
            onClick={onCancel}
            variant="text"
            color="error"
            disabled={isConfirming || isCancelling}
          >
            {isCancelling ? "Cancelling..." : "Cancel Import"}
          </Button>
          <Button
            type="button"
            variant="contained"
            onClick={onConfirm}
            disabled={isConfirming || isCancelling}
            startIcon={isConfirming ? <CircularProgress size={16} /> : undefined}
          >
            {isConfirming ? "Confirming..." : "Confirm Import"}
          </Button>
        </Stack>
      </Stack>
    </form>
  );
};

// --- Component ---

export const ReviewStep: React.FC<ReviewStepProps> = ({
  recommendations,
  onConnectorNameChange,
  onConfirm,
  isConfirming,
  confirmError,
  confirmResult,
  onDone,
  onCancel,
  isCancelling,
}) => {
  if (confirmResult) {
    return <CompletionSummary result={confirmResult} onDone={onDone} />;
  }

  if (!recommendations) {
    return null;
  }

  return (
    <ReviewForm
      recommendations={recommendations}
      onConnectorNameChange={onConnectorNameChange}
      onConfirm={onConfirm}
      isConfirming={isConfirming}
      confirmError={confirmError}
      onCancel={onCancel}
      isCancelling={isCancelling}
    />
  );
};
