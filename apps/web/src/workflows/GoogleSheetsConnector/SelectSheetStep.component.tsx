import React from "react";

import Alert from "@mui/material/Alert";

import {
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@portalai/core/ui";

import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";

export interface SelectSheetStepUIProps {
  /** Currently selected spreadsheetId, or null. */
  value: string | null;
  /** The picked spreadsheet's name, for display once chosen. */
  valueLabel: string | null;
  /** Opens the Google Picker. Resolves when the user picks or cancels. */
  onOpenPicker: () => void;
  /** True while the Picker script is loading — the affordance is disabled, no progress copy. */
  pickerLoading: boolean;
  /** True while the select-sheet POST is in flight — renders the "fetching contents" panel. */
  loading: boolean;
  /** Picker could not load (blocked script, missing key) — distinct from "no selection". */
  pickerUnavailable: boolean;
  /**
   * Set when the Google account authorized in the popup is not the account
   * this connector is bound to. Blocks the Picker; names both addresses.
   */
  accountMismatch: { expected: string; authorized: string } | null;
  serverError: ServerError | null;
}

/**
 * Picks the spreadsheet to import (#408).
 *
 * There is no search box here any more. The connector requests only
 * `drive.file`, which grants access to one file at a time and only through
 * Google's own Picker — so the app cannot list a user's spreadsheets, and
 * the Picker (which has its own search) is the selection surface.
 *
 * Failures name the right culprit. The old empty state read *"No
 * spreadsheets found — make sure the right Google account is connected"*,
 * which blamed the user's account for what was usually our missing config.
 * A Picker that will not load is a configuration problem and says so.
 */
export const SelectSheetStep: React.FC<SelectSheetStepUIProps> = ({
  value,
  valueLabel,
  onOpenPicker,
  pickerLoading,
  loading,
  pickerUnavailable,
  accountMismatch,
  serverError,
}) => {
  const busy = loading || pickerLoading;

  return (
    <Stack spacing={2}>
      <Typography variant="body1">
        Pick the spreadsheet you want to import. Google will ask you to choose
        an account and approve access to that one file — Portals AI never sees
        the rest of your Drive.
      </Typography>

      {serverError && <FormAlert serverError={serverError} />}

      {pickerUnavailable && (
        <Alert severity="error">
          The Google file picker could not load. This is a configuration problem
          on our side, not a problem with your Google account — please contact
          support if it persists.
        </Alert>
      )}

      {accountMismatch && (
        <Alert severity="warning">
          This connector is linked to {accountMismatch.expected}, but you
          authorized {accountMismatch.authorized}. Choose the linked account to
          pick a spreadsheet.
        </Alert>
      )}

      <Box>
        <Button
          variant="contained"
          onClick={onOpenPicker}
          disabled={busy || pickerUnavailable}
        >
          {value ? "Choose a different spreadsheet" : "Choose a spreadsheet"}
        </Button>
      </Box>

      {value && valueLabel && (
        <Typography variant="body2" color="text.secondary">
          Selected: <strong>{valueLabel}</strong>
        </Typography>
      )}

      {loading && (
        <Box
          data-testid="select-sheet-loading"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            py: 2,
            px: 1.5,
            borderRadius: 1,
            border: "1px dashed",
            borderColor: "divider",
          }}
        >
          <CircularProgress size={20} />
          <Stack spacing={0.25}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              Fetching spreadsheet contents…
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Streaming rows into the workbook cache. This usually takes a few
              seconds — larger sheets may take longer.
            </Typography>
          </Stack>
        </Box>
      )}
    </Stack>
  );
};
