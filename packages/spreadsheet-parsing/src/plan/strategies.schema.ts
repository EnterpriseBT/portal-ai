import { z } from "zod";

import { AxisMemberEnum } from "./enums.js";
import { LocatorSchema } from "./locator.schema.js";

// ── Header strategy ────────────────────────────────────────────────────────

const HeaderStrategyRowSchema = z.object({
  kind: z.literal("row"),
  locator: LocatorSchema,
  confidence: z.number().min(0).max(1),
});

const HeaderStrategyColumnSchema = z.object({
  kind: z.literal("column"),
  locator: LocatorSchema,
  confidence: z.number().min(0).max(1),
});

const HeaderStrategyRowLabelsSchema = z.object({
  kind: z.literal("rowLabels"),
  locator: LocatorSchema,
  confidence: z.number().min(0).max(1),
});

export const HeaderStrategySchema = z.discriminatedUnion("kind", [
  HeaderStrategyRowSchema,
  HeaderStrategyColumnSchema,
  HeaderStrategyRowLabelsSchema,
]);

export type HeaderStrategy = z.infer<typeof HeaderStrategySchema>;

// ── Identity strategy ──────────────────────────────────────────────────────

/**
 * `source` flags whether the strategy came from `detectIdentity`'s heuristic
 * pass (`"heuristic"`; safe to overwrite on re-interpret) or was explicitly
 * chosen by the user in the review step (`"user"`; locked — the heuristic
 * must round-trip it unchanged). Optional for backward-compat: prior plans
 * persisted without the field parse cleanly, and read sites treat the
 * absence as `"heuristic"` (the only value with consequence is `"user"`,
 * which gates the user-lock branch in `detect-identity`).
 */
const IdentityStrategySourceEnum = z.enum(["heuristic", "user"]).optional();

const IdentityStrategyColumnSchema = z.object({
  kind: z.literal("column"),
  sourceLocator: LocatorSchema,
  confidence: z.number().min(0).max(1),
  source: IdentityStrategySourceEnum,
});

const IdentityStrategyCompositeSchema = z.object({
  kind: z.literal("composite"),
  sourceLocators: z.array(LocatorSchema).min(2),
  joiner: z.string(),
  confidence: z.number().min(0).max(1),
  source: IdentityStrategySourceEnum,
});

const IdentityStrategyRowPositionSchema = z.object({
  kind: z.literal("rowPosition"),
  confidence: z.number().min(0).max(1),
  source: IdentityStrategySourceEnum,
});

export const IdentityStrategySchema = z.discriminatedUnion("kind", [
  IdentityStrategyColumnSchema,
  IdentityStrategyCompositeSchema,
  IdentityStrategyRowPositionSchema,
]);

export type IdentityStrategy = z.infer<typeof IdentityStrategySchema>;

// ── Column binding ─────────────────────────────────────────────────────────

const ByHeaderNameLocatorSchema = z.object({
  kind: z.literal("byHeaderName"),
  axis: AxisMemberEnum,
  name: z.string().min(1),
});

const ByPositionIndexLocatorSchema = z.object({
  kind: z.literal("byPositionIndex"),
  axis: AxisMemberEnum,
  /** 1-based ordinal along the axis's position list (not a sheet col/row). */
  index: z.number().int().min(1),
});

export const BindingSourceLocatorSchema = z.discriminatedUnion("kind", [
  ByHeaderNameLocatorSchema,
  ByPositionIndexLocatorSchema,
]);

export type BindingSourceLocator = z.infer<typeof BindingSourceLocatorSchema>;

// Shape of `FieldMapping.normalizedKey` — mirrors the regex enforced by
// `FieldMappingSchema` so the plan and the materialised row agree.
const NormalizedKeyPattern = /^[a-z][a-z0-9_]*$/;

export const ColumnBindingSchema = z
  .object({
    sourceLocator: BindingSourceLocatorSchema,
    // Nullable to admit the legitimate "AI couldn't classify and the user
    // opted out" state — a binding can carry confidence + rationale + a
    // user override of `excluded: true` without ever picking a column
    // definition. The refinement below keeps non-excluded bindings
    // strictly bound. Reconcile + commit drop excluded bindings before
    // any read of this field, so a `null` here never reaches downstream
    // logic.
    columnDefinitionId: z.string().min(1).nullable(),
    confidence: z.number().min(0).max(1),
    rationale: z.string().optional(),

    // ── User overrides (see BINDING_OVERRIDES.spec.md) ────────────────
    // All optional so prior plans without overrides remain parse-valid.
    // Reconcile reads these at commit time and falls back to the catalog
    // defaults when unset.
    excluded: z.boolean().optional(),
    normalizedKey: z.string().regex(NormalizedKeyPattern).optional(),
    required: z.boolean().optional(),
    defaultValue: z.string().nullable().optional(),
    format: z.string().nullable().optional(),
    enumValues: z.array(z.string()).nullable().optional(),
    refEntityKey: z.string().nullable().optional(),
    refNormalizedKey: z.string().nullable().optional(),
  })
  .refine(
    (b) =>
      b.excluded === true ||
      (typeof b.columnDefinitionId === "string" &&
        b.columnDefinitionId.length > 0),
    {
      message: "columnDefinitionId is required for non-excluded bindings",
      path: ["columnDefinitionId"],
    }
  );

export type ColumnBinding = z.infer<typeof ColumnBindingSchema>;
