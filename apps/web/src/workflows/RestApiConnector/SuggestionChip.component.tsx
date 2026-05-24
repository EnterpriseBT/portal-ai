/**
 * Adopt-suggestion chip rendered next to each inferred-columns row
 * when the AI-assist layer returned a suggestion for the column.
 *
 * Renders the suggested normalizedKey + confidence percentage in a
 * compact chip; clicking calls `onAdopt` (the parent copies the
 * suggestion into the row's editable fields). Hovering the chip
 * shows the LLM rationale + matched columnDefinitionId (if any).
 * Low-confidence suggestions (< 0.5) render with a muted style + a
 * "Low confidence; review carefully" affordance.
 */

import React from "react";

import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import type { ApiColumnSuggestion } from "@portalai/core/contracts";

export const LOW_CONFIDENCE_THRESHOLD = 0.5;

export interface SuggestionChipUIProps {
  suggestion: ApiColumnSuggestion;
  onAdopt: () => void;
}

export const SuggestionChipUI: React.FC<SuggestionChipUIProps> = ({
  suggestion,
  onAdopt,
}) => {
  const pct = Math.round(suggestion.confidence * 100);
  const low = suggestion.confidence < LOW_CONFIDENCE_THRESHOLD;

  const tooltipBody = [
    suggestion.rationale,
    low ? "Low confidence — review carefully before adopting." : null,
    suggestion.columnDefinitionId
      ? `Matched catalog entry: ${suggestion.columnDefinitionId}`
      : "No catalog match — suggesting a fresh column.",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <Tooltip title={tooltipBody}>
      <Chip
        label={`${suggestion.suggestedNormalizedKey} • ${pct}%`}
        size="small"
        color={low ? "default" : "primary"}
        variant={low ? "outlined" : "filled"}
        onClick={onAdopt}
        aria-label={`Adopt suggestion ${suggestion.suggestedNormalizedKey}`}
      />
    </Tooltip>
  );
};
