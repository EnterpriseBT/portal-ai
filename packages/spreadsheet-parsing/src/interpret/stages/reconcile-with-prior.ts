import type { IdentityStrategy, LayoutPlan, Region } from "../../plan/index.js";
import type { InterpretState, ReconcileDiff } from "../types.js";

/**
 * Region fingerprint used to match this-plan regions to prior-plan regions.
 * Deliberately coarse — sheet + target entity + bounds. This is sufficient
 * for Mode A drift prevention; Mode B tuning happens in Phase 5.
 */
function fingerprint(r: Region): string {
  const b = r.bounds;
  return [
    r.sheet,
    r.targetEntityDefinitionId,
    b.startRow,
    b.startCol,
    b.endRow,
    b.endCol,
  ].join("|");
}

function identityStrategyFingerprint(s: IdentityStrategy): string {
  if (s.kind === "column") {
    const l = s.sourceLocator;
    return `column:${l.kind === "column" ? l.col : -1}`;
  }
  if (s.kind === "composite") {
    return `composite:${s.sourceLocators
      .map((l) => (l.kind === "column" ? l.col : l.kind === "row" ? l.row : 0))
      .join(",")}`;
  }
  return "rowPosition";
}

/**
 * Stage 7 — only fires when a prior plan exists. Preserves region ids where
 * fingerprints match; classifies added/removed/identityChanged.
 *
 * No-op when no prior plan is supplied (Mode A snapshot uploads).
 */
export function reconcileWithPrior(state: InterpretState): InterpretState {
  const prior = state.input.priorPlan as LayoutPlan | undefined;
  if (!prior) return state;

  const priorByFp = new Map<string, Region>();
  for (const r of prior.regions) priorByFp.set(fingerprint(r), r);

  const matchedPriorFps = new Set<string>();
  const preserved: string[] = [];
  const added: string[] = [];
  const identityChanged: string[] = [];

  const detectedRegions = state.detectedRegions.map<Region>((r) => {
    const fp = fingerprint(r);
    const match = priorByFp.get(fp);
    if (match) {
      matchedPriorFps.add(fp);
      preserved.push(match.id);
      if (
        identityStrategyFingerprint(match.identityStrategy) !==
        identityStrategyFingerprint(r.identityStrategy)
      ) {
        identityChanged.push(match.id);
      }
      return { ...r, id: match.id };
    }
    added.push(r.id);
    return r;
  });

  const removed: string[] = [];
  for (const [fp, r] of priorByFp.entries()) {
    if (!matchedPriorFps.has(fp)) removed.push(r.id);
  }

  const reconcileDiff: ReconcileDiff = {
    preserved,
    added,
    removed,
    identityChanged,
  };

  return { ...state, detectedRegions, reconcileDiff };
}
