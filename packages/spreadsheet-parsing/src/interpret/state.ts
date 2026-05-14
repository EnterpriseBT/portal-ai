import { InterpretInputSchema } from "../plan/index.js";
import type { InterpretInput } from "../plan/index.js";
import { makeWorkbook } from "../workbook/helpers.js";
import type { Workbook, WorkbookData } from "../workbook/types.js";
import type { InterpretState } from "./types.js";

/**
 * Runtime shape accepted by `interpret()`. The `workbook` field accepts
 * either a serialisable `WorkbookData` (route-layer input) or an
 * already-adapted `Workbook` — the latter is the seam the lazy
 * row-async path uses to thread a chunked-cache-backed sheet through
 * the parser without materialising every cell. The non-workbook
 * fields still validate against `InterpretInputSchema`.
 */
export interface InterpretRuntimeInput
  extends Omit<InterpretInput, "workbook"> {
  workbook: Workbook | WorkbookData;
}

function isAdaptedWorkbook(
  workbook: Workbook | WorkbookData
): workbook is Workbook {
  return (
    workbook.sheets.length > 0 &&
    "cell" in workbook.sheets[0] &&
    typeof workbook.sheets[0].cell === "function"
  );
}

export function createInitialState(
  input: InterpretRuntimeInput
): InterpretState {
  // Validate every input field except `workbook`. The workbook is
  // accepted as-is when it's already adapted (the Sheet contract —
  // `cell`, `loadRange`, `dimensions` — is the validation seam for
  // the lazy path), and run through `WorkbookSchema` via
  // `makeWorkbook` when it arrives as serialisable `WorkbookData`.
  const validated = InterpretInputSchema.omit({ workbook: true }).parse({
    regionHints: input.regionHints,
    priorPlan: input.priorPlan,
    driftReport: input.driftReport,
    userHints: input.userHints,
  });
  const workbook: Workbook = isAdaptedWorkbook(input.workbook)
    ? input.workbook
    : makeWorkbook(input.workbook);

  return {
    input: {
      regionHints: validated.regionHints,
      priorPlan: validated.priorPlan,
      userHints: validated.userHints,
    },
    workbook,
    detectedRegions: [],
    headerCandidates: new Map(),
    identityCandidates: new Map(),
    columnClassifications: new Map(),
    segmentAxisNameSuggestions: new Map(),
    segmentsByRegion: new Map(),
    cellValueFieldByRegion: new Map(),
    confidence: new Map(),
    warnings: [],
  };
}
