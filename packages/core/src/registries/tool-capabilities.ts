import type { ToolCapability } from "../models/tool-capability.model.js";
import { BUILTIN_TOOLPACKS } from "./builtin-toolpacks.js";

/**
 * Capability projections (#121 child A, slice 3).
 *
 * The capability metadata declared on every tool (the registry + the two
 * system tools below) is the single source the three projections read:
 *   - **enablement** — which tools attach (always-available, write-gated)
 *   - **enforcement** — cost-ack, the entity lock
 *   - **UI/discovery** — the pack grouping (unchanged; lives in the registry)
 *
 * This module exposes the enablement + enforcement projections as pure
 * derivations over capability. It is **behavior-neutral**: nothing here is
 * wired into the enforcement paths yet — that swap (deleting the
 * `SYSTEM_TOOL_PACKS` constant, the pack-level write-gate, the slug-keyed
 * cost-ack / 409 lock) is child B. Child A only proves, by test, that the
 * metadata reproduces today's behavior.
 */

// ── System tools ────────────────────────────────────────────────────
//
// `current_time` and `station_context` are always attached (today via the
// `SYSTEM_TOOL_PACKS = ["station_context"]` constant in
// `apps/api/src/services/tools.service.ts`). They live outside the six-pack
// registry — instantiated directly in tools.service — so their capability
// is declared here. `alwaysAvailable: true` is the metadata equivalent of
// membership in `SYSTEM_TOOL_PACKS`.

export const SYSTEM_TOOL_CAPABILITIES: Record<string, ToolCapability> = {
  current_time: {
    pure: true,
    reads: [],
    writes: [],
    consumption: { mode: "none" },
    computeShape: "pure",
    costHint: "free",
    locks: [],
    resultKind: "scalar",
    alwaysAvailable: true,
  },
  station_context: {
    pure: false,
    reads: ["entity_records"],
    writes: [],
    consumption: { mode: "none" },
    computeShape: "scan",
    costHint: "free",
    locks: [],
    resultKind: "data-table",
    alwaysAvailable: true,
  },
};

// ── Aggregate ───────────────────────────────────────────────────────

/** Every tool's capability keyed by tool name — built-in packs + system
 *  tools. The substrate the projections below read. */
export const ALL_TOOL_CAPABILITIES: Record<string, ToolCapability> = (() => {
  const map: Record<string, ToolCapability> = { ...SYSTEM_TOOL_CAPABILITIES };
  for (const pack of BUILTIN_TOOLPACKS) {
    for (const tool of pack.tools) {
      map[tool.name] = tool.capability;
    }
  }
  return map;
})();

// ── Enforcement predicates (pure derivations) ───────────────────────

/** Tool is gated by the cost-acknowledgement flow (`acknowledgeCost`). */
export function isCostGated(cap: ToolCapability): boolean {
  return cap.costHint === "expensive";
}

/** Tool requires the station's connectors to permit writes. Per-tool
 *  (finer than today's pack-level gate); the set is identical for the
 *  built-ins since every entity_management tool writes. */
export function isWriteGated(cap: ToolCapability): boolean {
  return cap.writes.length > 0;
}

/** Tool is attached to every station regardless of config. */
export function isAlwaysAvailable(cap: ToolCapability): boolean {
  return cap.alwaysAvailable;
}

/** Job-metadata keys whose ids this tool locks while in flight (drives the
 *  409 ENTITY_LOCKED_BY_JOB check once child B reads it). */
export function entityLockKeys(cap: ToolCapability): readonly string[] {
  return cap.locks;
}

// ── Name-set projections (sorted, for equivalence checks + B's wiring) ──

function namesWhere(pred: (cap: ToolCapability) => boolean): string[] {
  return Object.entries(ALL_TOOL_CAPABILITIES)
    .filter(([, cap]) => pred(cap))
    .map(([name]) => name)
    .sort();
}

/** Tools always attached — the metadata equivalent of `SYSTEM_TOOL_PACKS`. */
export function alwaysAvailableToolNames(): string[] {
  return namesWhere(isAlwaysAvailable);
}

/** Tools gated on write capability — the metadata equivalent of the
 *  pack-level `entity_management` write-gate. */
export function writeGatedToolNames(): string[] {
  return namesWhere(isWriteGated);
}

/** Tools behind the cost-ack gate — the metadata equivalent of the
 *  slug-keyed `costHint: "expensive"` check. */
export function costGatedToolNames(): string[] {
  return namesWhere(isCostGated);
}
