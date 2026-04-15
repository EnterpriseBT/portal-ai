import React, { useState } from "react";

import { z } from "zod";
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

import { validateWithSchema, focusFirstInvalidField, type FormErrors } from "../../utils/form-validation.util";
import type { Recommendations } from "./utils/upload-workflow.util";

const ConnectorNameSchema = z.object({
  name: z.string().trim().min(1, "Connector name is required"),
});

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
                  <>
                    <Typography variant="body2" color="text.secondary">
                      {entity.importResult.created} record{entity.importResult.created !== 1 ? "s" : ""} imported
                      {entity.importResult.updated > 0 && `, ${entity.importResult.updated} updated`}
                      {entity.importResult.unchanged > 0 && `, ${entity.importResult.unchanged} unchanged`}
                    </Typography>
                    {entity.importResult.invalid > 0 && (
                      <Typography variant="body2" color="warning.main">
                        {entity.importResult.invalid} record{entity.importResult.invalid !== 1 ? "s" : ""} imported with validation errors (review and fix in the records view)
                      </Typography>
                    )}
                  </>
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

function formatRefTarget(col: {
  refEntityKey?: string | null;
  refNormalizedKey?: string | null;
}): string {
  if (col.refEntityKey && col.refNormalizedKey) {
    return ` → ${col.refEntityKey}.${col.refNormalizedKey}`;
  }
  if (col.refEntityKey) {
    return ` → ${col.refEntityKey}`;
  }
  return "";
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
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const totalColumns = entities.reduce((sum, e) => sum + e.columns.length, 0);

  const validate = (data: { name: string }): FormErrors => {
    const result = validateWithSchema(ConnectorNameSchema, data);
    return result.success ? {} : result.errors;
  };

  const handleConfirm = () => {
    setTouched({ name: true });
    const formErrors = validate({ name: connectorInstance.name });
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }
    onConfirm();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!isConfirming && !isCancelling) handleConfirm();
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
            onChange={(e) => {
              onConnectorNameChange(e.target.value);
              if (touched.name) {
                setErrors(validate({ name: e.target.value }));
              }
            }}
            onBlur={() => {
              setTouched((prev) => ({ ...prev, name: true }));
              setErrors(validate({ name: connectorInstance.name }));
            }}
            error={touched.name && !!errors.name}
            helperText={touched.name && errors.name}
            slotProps={{ htmlInput: { "aria-invalid": touched.name && !!errors.name } }}
            required
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
              Total columns: {totalColumns}
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
              {entity.columns.map((col, colIdx) => {
                const nk = col.normalizedKey ?? col.sourceField;
                return (
                  <Stack key={colIdx} spacing={0.25} sx={{ py: 0.5 }}>
                    <Stack
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
                        {nk}{formatRefTarget(col)}
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ pl: 2 }}>
                      normalizedKey: {nk}
                      {col.required && " · required"}
                      {col.format && ` · format: ${col.format}`}
                      {col.defaultValue && ` · default: ${col.defaultValue}`}
                    </Typography>
                  </Stack>
                );
              })}
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
            onClick={handleConfirm}
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
