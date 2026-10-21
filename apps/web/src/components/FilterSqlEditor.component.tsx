import React from "react";

import type { CuratedViewFilterSqlPreviewResponsePayload } from "@portalai/core/contracts";
import Alert from "@mui/material/Alert";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { Button, Stack } from "@portalai/core/ui";

import { FilterSqlPreviewUI } from "./FilterSqlPreview.component";
import { FormAlert } from "./FormAlert.component";
import { blurUnlessDialogControl } from "../utils/dialog-blur.util";
import type { ServerError } from "../utils/api.util";

export interface FilterSqlEditorUIProps {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: string;
  touched: boolean;
  /** The column keys the filter may reference, shown as a reminder. */
  columnKeys: string[];
  /** A stored filter the org's plan no longer lets anyone edit: shown, not
   *  editable, with no assist. */
  readOnly: boolean;
  suggest: {
    prompt: string;
    onPromptChange: (value: string) => void;
    onSuggest: () => void;
    pending: boolean;
    serverError: ServerError | null;
    /** Set when the first suggestion was refused and revised. */
    warning: string | null;
  };
  preview: {
    onRun: () => void;
    pending: boolean;
    serverError: ServerError | null;
    result: CuratedViewFilterSqlPreviewResponsePayload | null;
  };
}

/**
 * #644: the advanced (SQL) row filter editor: the fragment, a "describe the
 * rows" assist that suggests one, and a preview of the rows it selects.
 */
export const FilterSqlEditorUI: React.FC<FilterSqlEditorUIProps> = ({
  value,
  onChange,
  onBlur,
  error,
  touched,
  columnKeys,
  readOnly,
  suggest,
  preview,
}) => {
  const invalid = touched && !!error;
  return (
    <Stack spacing={1.5}>
      {readOnly && (
        <Alert severity="info">
          Your plan no longer includes SQL filters. This filter still applies,
          but it can&apos;t be edited. Switch to the builder to replace it.
        </Alert>
      )}
      {!readOnly && (
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              label="Describe the rows you want"
              value={suggest.prompt}
              onChange={(e) => suggest.onPromptChange(e.target.value)}
              placeholder="Active parcels within a mile of the office"
              fullWidth
              multiline
              maxRows={3}
              size="small"
            />
            <Button
              type="button"
              variant="outlined"
              onClick={suggest.onSuggest}
              disabled={suggest.pending || !suggest.prompt.trim()}
              sx={{ whiteSpace: "nowrap" }}
            >
              {suggest.pending ? "Suggesting…" : "Suggest"}
            </Button>
          </Stack>
          <FormAlert serverError={suggest.serverError} />
          {suggest.warning && (
            <Alert severity="warning">{suggest.warning}</Alert>
          )}
        </Stack>
      )}
      <TextField
        label="SQL filter"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={blurUnlessDialogControl(onBlur)}
        error={invalid}
        helperText={
          (touched && error) ||
          "A condition over this entity's columns, e.g. amount > cost"
        }
        slotProps={{
          htmlInput: {
            "aria-invalid": invalid,
            readOnly,
            spellCheck: false,
            style: { fontFamily: "monospace" },
          },
        }}
        required
        fullWidth
        multiline
        minRows={3}
      />
      {columnKeys.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          Columns: {columnKeys.join(", ")}
        </Typography>
      )}
      <Stack direction="row" spacing={1} alignItems="center">
        <Button
          type="button"
          variant="text"
          onClick={preview.onRun}
          disabled={preview.pending || !value.trim()}
        >
          Run preview
        </Button>
      </Stack>
      <FilterSqlPreviewUI
        pending={preview.pending}
        serverError={preview.serverError}
        result={preview.result}
      />
    </Stack>
  );
};
