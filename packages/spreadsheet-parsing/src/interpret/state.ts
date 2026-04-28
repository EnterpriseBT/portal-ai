import { InterpretInputSchema } from "../plan/index.js";
import type { InterpretInput } from "../plan/index.js";
import { makeWorkbook } from "../workbook/helpers.js";
import type { InterpretState } from "./types.js";

export function createInitialState(input: InterpretInput): InterpretState {
  const validated = InterpretInputSchema.parse(input);
  const workbook = makeWorkbook(validated.workbook);

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
