import { z } from "zod";

/**
 * Tool capability metadata — the single declared source from which the
 * three projections (pack/UI, station enablement, enforcement) and the
 * runtime cardinality selection are derived. See
 * `docs/TOOLPACK_TAXONOMY.spec.md`.
 *
 * Declared in code for built-in tools (the `ToolpackTool` registry,
 * `builtin-toolpacks.ts`) and in the served `/schema` for custom-webhook
 * packs (`ToolpackToolDefinitionSchema`). Custom tools are additionally
 * constrained to the pure-consumer subset — that stricter rule is enforced
 * at registration (child I), not by this base schema.
 *
 * `pure` here means the discovery sense: the tool touches no backend at
 * all — it computes only over the records/params handed to it (the 8
 * pure-math financial tools, and the streaming/bounded escape-hatch
 * compute tools whose rows the runtime resolves and feeds in). A tool that
 * pushes its reduction to the engine (`engine-pushdown`) is therefore NOT
 * pure — pushdown is a read.
 */

// ── Cardinality contract ────────────────────────────────────────────

export const ConsumptionModeSchema = z.enum([
  "none", // takes no record input (pure-math / external)
  "engine-pushdown", // computation expressed to the engine; exact at any N (a read)
  "streaming", // maintains state over a batch stream; exact/bounded-error at any N
  "bounded", // needs the whole set in memory; honestly capped
]);
export type ConsumptionMode = z.infer<typeof ConsumptionModeSchema>;

export const OnOverflowSchema = z.enum([
  "stream", // escalate to a streaming variant if one exists
  "sample", // reservoir-sample down to maxRows (flagged in the result)
  "decompose", // map-assign + sample-reduce
  "error", // COMPUTE_INPUT_TOO_LARGE
]);
export type OnOverflow = z.infer<typeof OnOverflowSchema>;

/**
 * How a tool can take its dataset — a ceiling, not a mandate
 * (`bounded ⊂ streaming ≈ engine-pushdown`). A `streaming`/`engine-pushdown`
 * tool still runs inline at small N with zero overhead; the heavier
 * machinery engages only when N demands it. `bounded` declares what happens
 * past `maxRows` via `onOverflow`, always surfaced — never silent.
 */
export const ConsumptionSchema = z
  .object({
    mode: ConsumptionModeSchema,
    maxRows: z.number().int().positive().optional(),
    onOverflow: OnOverflowSchema.optional(),
  })
  .refine(
    (c) =>
      (c.mode === "bounded") === (c.maxRows != null && c.onOverflow != null),
    {
      message:
        "consumption mode 'bounded' requires maxRows + onOverflow; other modes must omit them",
    }
  );
export type Consumption = z.infer<typeof ConsumptionSchema>;

// ── Result + shape + cost ───────────────────────────────────────────

/** The render category of the tool's result (discovery D6) — a passive
 *  label, NOT a render trigger. It answers "render as what?" *if* a result
 *  is surfaced for display; it does not mean every call renders. Most
 *  results in a chain are intermediate (e.g. a handle threaded into the
 *  next call) and never reach `resolveDisplayBlock`. When a result IS
 *  surfaced, the web renderer registry (D7) dispatches on this value; the
 *  portal/agent layer stays agnostic to it. */
export const ResultKindSchema = z.enum([
  "data-table",
  "scalar",
  "vega-lite", // high-level Vega-Lite spec (the `visualize` tool)
  "vega", // full Vega spec — trees/networks (the `visualize_tree` tool)
  "d3", // sandboxed D3 render program (#268)
  "geo", // GIS map (#84, child H)
  "mutation-result",
  "progress",
]);
export type ResultKind = z.infer<typeof ResultKindSchema>;

export const ComputeShapeSchema = z.enum([
  "scan",
  "reduce",
  "map",
  "mutate",
  "visualize",
  "pure",
]);
export type ComputeShape = z.infer<typeof ComputeShapeSchema>;

/** Reuses the existing cost-acknowledgement vocabulary
 *  (`BulkDispatchMetadata.costHint`): "free" → no gate, "metered" →
 *  surface cost/ETA, "expensive" → route requires `acknowledgeCost`. */
export const CostHintSchema = z.enum(["free", "metered", "expensive"]);
export type CostHint = z.infer<typeof CostHintSchema>;

// ── Production (output cardinality, #161) ───────────────────────────

/** What happens to a `rows` output once it exceeds the inline threshold —
 *  the output mirror of `consumption.onOverflow`. */
export const OnLargeSchema = z.enum([
  "handle", // stage a query handle (the scaling default for data/charts)
  "sample", // reservoir-sample to the threshold, flagged in the result
  "error", // throw COMPUTE_OUTPUT_TOO_LARGE
]);
export type OnLarge = z.infer<typeof OnLargeSchema>;

/**
 * Output cardinality — the declared mirror of `consumption` (#161). The
 * resolver (`result-sink.ts`) honors it by observed N: a `value` is always
 * inline; a `rows` output is inline ≤ `inlineThreshold` (default
 * `INLINE_ROWS_THRESHOLD`) and otherwise follows `onLarge`. Orthogonal to
 * `resultKind` (delivery vs render): a `rows` output renders per its
 * `resultKind`; a `value` renders as prose (no display block).
 */
export const ProductionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("value") }).strict(),
  z
    .object({
      kind: z.literal("rows"),
      onLarge: OnLargeSchema,
      inlineThreshold: z.number().int().positive().optional(),
    })
    .strict(),
]);
export type Production = z.infer<typeof ProductionSchema>;

// ── Capability ──────────────────────────────────────────────────────

export const ToolCapabilitySchema = z
  .object({
    /** Touches no backend — computes only over handed-in records/params. */
    pure: z.boolean(),
    /** Entity kinds the tool reads, e.g. ["entity_records"]. */
    reads: z.array(z.string()),
    /** Entity kinds the tool writes. */
    writes: z.array(z.string()),
    consumption: ConsumptionSchema,
    computeShape: ComputeShapeSchema,
    costHint: CostHintSchema,
    /** Job-metadata keys whose ids this tool locks while in flight,
     *  e.g. ["recordIds","connectorInstanceId"] (drives the 409 lock). */
    locks: z.array(z.string()),
    resultKind: ResultKindSchema,
    /** Output cardinality (#161) — the mirror of `consumption`. Drives the
     *  result-sink resolver's inline-vs-handle decision. */
    production: ProductionSchema,
    /** Always attached regardless of station config (replaces
     *  `SYSTEM_TOOL_PACKS`). */
    alwaysAvailable: z.boolean(),
  })
  .superRefine((cap, ctx) => {
    // pure ⇒ no backend interaction of any kind.
    if (cap.pure) {
      if (
        cap.reads.length > 0 ||
        cap.writes.length > 0 ||
        cap.locks.length > 0 ||
        cap.consumption.mode === "engine-pushdown"
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "pure tools cannot read, write, lock, or push down to the engine",
        });
      }
    }
    // engine-pushdown is a read.
    if (cap.consumption.mode === "engine-pushdown" && cap.reads.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "engine-pushdown consumption requires a non-empty reads[]",
      });
    }
    // writes ⇒ mutating shape + a declared lock.
    if (cap.writes.length > 0) {
      if (cap.computeShape !== "map" && cap.computeShape !== "mutate") {
        ctx.addIssue({
          code: "custom",
          message: "writing tools must have computeShape 'map' or 'mutate'",
        });
      }
      if (cap.locks.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "writing tools must declare the entity ids they lock",
        });
      }
    }
    // mutation/progress result ⇒ the tool writes.
    if (
      (cap.resultKind === "mutation-result" || cap.resultKind === "progress") &&
      cap.writes.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "resultKind 'mutation-result'/'progress' requires a non-empty writes[]",
      });
    }
    // production (delivery) ⟂ resultKind (render), but the two cannot
    // contradict (#161): a `scalar` render is inherently a single value, and
    // a mutation ack is a value — both must be value-delivered. Conversely a
    // `value` output can only render as scalar/mutation-result (there are no
    // rows to draw as a table/chart).
    if (cap.resultKind === "scalar" && cap.production.kind !== "value") {
      ctx.addIssue({
        code: "custom",
        message: "resultKind 'scalar' requires production.kind 'value'",
      });
    }
    if (
      cap.resultKind === "mutation-result" &&
      cap.production.kind !== "value"
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "resultKind 'mutation-result' requires production.kind 'value'",
      });
    }
    if (
      cap.production.kind === "value" &&
      cap.resultKind !== "scalar" &&
      cap.resultKind !== "mutation-result" &&
      cap.resultKind !== "progress"
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "production.kind 'value' can only render as resultKind 'scalar'/'mutation-result'/'progress'",
      });
    }
  });
export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;

/**
 * Producer/transformer/consumer role — a *derived view* over the
 * capability fields (discovery D2), not a declared field. Used for docs
 * and the agent prompt.
 */
export type ToolRole = "producer" | "transformer" | "consumer" | "none";

export function deriveToolRole(cap: ToolCapability): ToolRole {
  if (cap.writes.length > 0) return "transformer"; // reads/consumes then writes
  if (cap.computeShape === "scan") return "producer"; // emits a row set / handle
  if (cap.consumption.mode !== "none") return "consumer"; // reduces/visualizes a consumed set
  return "none"; // pure-math: no record input, no output dataset
}

/**
 * Validate a custom (webhook) tool's declared capability against the
 * **pure-consumer subset** (#121 child I, discovery D7). Custom tools run
 * third-party with no backend access, so they may declare only a constrained
 * slice of the capability model. Returns a human-readable reason when the
 * capability is outside the subset, or `null` when it's allowed.
 *
 * Note that the base `ToolCapabilitySchema` refinements already reject the
 * privileged combinations (pure ⇒ no reads/writes/locks/engine-pushdown;
 * mutation-result ⇒ writes). This adds the *custom-only* rules on top:
 * `pure` is mandatory, no `alwaysAvailable`, compute shape limited to
 * map/reduce/pure, no write-result render kinds, and the consumption mode
 * gated to what the runtime can actually feed today (`allowedConsumptionModes`
 * — `["none"]` until #124 ships the records-in-body / pull-on-read transport).
 */
export function customToolCapabilityError(
  cap: ToolCapability,
  opts: { allowedConsumptionModes: readonly ConsumptionMode[] }
): string | null {
  if (!cap.pure) {
    return "custom tools must be pure — they have no backend access (no reads, writes, locks, or engine pushdown)";
  }
  if (cap.alwaysAvailable) {
    return "custom tools cannot be always-available";
  }
  if (
    cap.computeShape !== "map" &&
    cap.computeShape !== "reduce" &&
    cap.computeShape !== "pure"
  ) {
    return `custom tools cannot declare computeShape '${cap.computeShape}' (only map, reduce, or pure)`;
  }
  if (cap.resultKind === "mutation-result" || cap.resultKind === "progress") {
    return `custom tools cannot declare resultKind '${cap.resultKind}' (they don't write)`;
  }
  if (!opts.allowedConsumptionModes.includes(cap.consumption.mode)) {
    return `custom tools cannot declare consumption mode '${cap.consumption.mode}' yet (allowed: ${opts.allowedConsumptionModes.join(", ")})`;
  }
  return null;
}
