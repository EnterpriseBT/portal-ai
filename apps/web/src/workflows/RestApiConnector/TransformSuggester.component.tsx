/**
 * AI-assist affordance for the JSONata transform editor.
 *
 * Pure UI by the Component File Policy: receives the prompt-hint
 * value + callbacks + flags, renders a small textarea + Suggest
 * button + optional FormAlert. No SDK access, no state. Lives
 * directly above `TransformEditorUI` inside `ApiEndpointFormUI`'s
 * transform-mode branch.
 *
 * The Suggest button stays visible even when disabled (so the
 * affordance doesn't disappear); the disabled tooltip explains why
 * — typically "Run Preview first to capture a sample response."
 */

import React from "react";

import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";

import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";

const PROMPT_PLACEHOLDER =
  'Describe what records you want (optional) — e.g. "one row per order line item"';

export interface TransformSuggesterUIProps {
  /** Current value of the prompt-hint textarea. */
  promptHint: string;
  /** Fires when the user types in the textarea. */
  onPromptHintChange: (value: string) => void;
  /** Fires when the user clicks Suggest. The container owns the SDK call. */
  onSuggest: () => void;
  /** True while the suggest mutation is in flight. Disables + relabels the button. */
  isSuggesting: boolean;
  /**
   * Disabled-for-precondition state, independent of `isSuggesting`. The
   * canonical case is "no preview response captured yet"; the tooltip
   * explains it via `disabledReason`.
   */
  disabled: boolean;
  /** Tooltip body when `disabled` is true. */
  disabledReason?: string;
  /** Mutation error projected through `toServerError`; renders a FormAlert when set. */
  serverError?: ServerError | null;
}

export const TransformSuggesterUI: React.FC<TransformSuggesterUIProps> = ({
  promptHint,
  onPromptHintChange,
  onSuggest,
  isSuggesting,
  disabled,
  disabledReason,
  serverError,
}) => {
  const buttonDisabled = disabled || isSuggesting;
  const button = (
    <Button
      type="button"
      variant="contained"
      size="small"
      disabled={buttonDisabled}
      onClick={onSuggest}
    >
      {isSuggesting ? "Suggesting…" : "Suggest"}
    </Button>
  );

  return (
    <Stack spacing={1} data-testid="transform-suggester">
      <TextField
        label="Suggestion hint"
        value={promptHint}
        placeholder={PROMPT_PLACEHOLDER}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onPromptHintChange(e.target.value)
        }
        multiline
        minRows={1}
        maxRows={3}
        fullWidth
        size="small"
        slotProps={{
          htmlInput: {
            "aria-label": "Suggestion hint",
            spellCheck: false,
          },
          inputLabel: { shrink: true },
        }}
      />

      <Stack direction="row" alignItems="center" spacing={1}>
        {disabled && disabledReason ? (
          // Tooltip cannot wrap a disabled <button>, so anchor on a
          // <span> for the title to surface on hover/focus.
          <Tooltip title={disabledReason}>
            <span>{button}</span>
          </Tooltip>
        ) : (
          button
        )}
      </Stack>

      <FormAlert serverError={serverError ?? null} />
    </Stack>
  );
};
