import React, { useCallback } from "react";

import { Stack, Typography } from "@portalai/core/ui";
import {
  AsyncSearchableSelect,
  type SelectOption,
} from "@portalai/core/ui";

import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";

export interface SelectWorkbookStepUIProps {
  /** Currently selected driveItemId, or null. */
  value: string | null;
  /** Called when the user picks a workbook. */
  onSelect: (driveItemId: string) => void;
  /**
   * Async search delegating to the SDK's searchWorkbooks. Returns
   * `SelectOption[]` shaped from the `items` payload.
   */
  searchFn: (query: string) => Promise<SelectOption[]>;
  /** True while the server-side select-workbook POST is in flight. */
  loading: boolean;
  serverError: ServerError | null;
}

const NO_OPTIONS_LABEL =
  "No workbooks found — make sure the right Microsoft account is connected.";

export const SelectWorkbookStep: React.FC<SelectWorkbookStepUIProps> = ({
  value,
  onSelect,
  searchFn,
  loading,
  serverError,
}) => {
  const handleChange = useCallback(
    (next: string | null) => {
      if (next) onSelect(next);
    },
    [onSelect]
  );

  return (
    <Stack spacing={2}>
      <Typography variant="body1">
        Pick the Excel workbook you want to import. Type to search by name.
      </Typography>

      {serverError && <FormAlert serverError={serverError} />}

      <AsyncSearchableSelect
        value={value}
        onChange={handleChange}
        onSearch={searchFn}
        label="Workbook"
        placeholder="Start typing a workbook name…"
        disabled={loading}
        fullWidth
        noOptionsText={NO_OPTIONS_LABEL}
      />
    </Stack>
  );
};
