/**
 * Advisory banner rendered above the inferred-columns table when the
 * AI-assist layer didn't run (because it errored) so the user knows
 * the suggestions chips are missing for a reason.
 *
 * Renders:
 *   - `degradation: "llm-failed"` → `<Alert severity="info">` strip
 *     explaining suggestions are unavailable and the user can still
 *     edit the inferred types manually.
 *   - `degradation: "llm-disabled"` → renders nothing (the spec
 *     considers an unconfigured classifier a normal mode, not a
 *     degradation worth surfacing to end users).
 *   - `degradation: null` → renders nothing.
 */

import React from "react";

import Alert from "@mui/material/Alert";

export interface DegradationBannerUIProps {
  degradation: "llm-failed" | "llm-disabled" | null;
}

export const DegradationBannerUI: React.FC<DegradationBannerUIProps> = ({
  degradation,
}) => {
  if (degradation !== "llm-failed") return null;
  return (
    <Alert severity="info">
      AI suggestions unavailable for this probe — you can still inspect the
      inferred types and configure columns manually.
    </Alert>
  );
};
