/**
 * Advisory banner rendered above the inferred-columns table when the
 * AI-assist or transform layer didn't run (because it errored) so the
 * user knows the suggestions chips are missing for a reason.
 *
 * Renders:
 *   - `degradation: "llm-failed"` → `<Alert severity="info">` strip
 *     explaining suggestions are unavailable and the user can still
 *     edit the inferred types manually.
 *   - `degradation: "transform-failed"` → `<Alert severity="warning">`
 *     surfacing the parse/runtime error message from the JSONata
 *     transform; the table will be empty because no records were
 *     extracted. The user fixes the transform in step 2.
 *   - `degradation: "llm-disabled"` → renders nothing (the spec
 *     considers an unconfigured classifier a normal mode, not a
 *     degradation worth surfacing to end users).
 *   - `degradation: null` → renders nothing.
 */

import React from "react";

import Alert from "@mui/material/Alert";

export interface DegradationBannerUIProps {
  degradation: "llm-failed" | "llm-disabled" | "transform-failed" | null;
  /**
   * Populated only when `degradation === "transform-failed"`. The
   * parse / runtime classification + the error message from the
   * JSONata runtime so the user knows what to fix.
   */
  transformError?: { kind: "parse" | "runtime"; message: string } | null;
}

export const DegradationBannerUI: React.FC<DegradationBannerUIProps> = ({
  degradation,
  transformError,
}) => {
  if (degradation === "transform-failed") {
    return (
      <Alert severity="warning">
        Transform {transformError?.kind ?? "runtime"} error: {transformError?.message ?? "JSONata expression failed."}
      </Alert>
    );
  }
  if (degradation === "llm-failed") {
    return (
      <Alert severity="info">
        AI suggestions unavailable for this probe — you can still inspect the
        inferred types and configure columns manually.
      </Alert>
    );
  }
  return null;
};
