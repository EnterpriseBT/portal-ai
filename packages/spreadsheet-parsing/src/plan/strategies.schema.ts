import { z } from "zod";

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

const IdentityStrategyColumnSchema = z.object({
  kind: z.literal("column"),
  sourceLocator: LocatorSchema,
  confidence: z.number().min(0).max(1),
});

const IdentityStrategyCompositeSchema = z.object({
  kind: z.literal("composite"),
  sourceLocators: z.array(LocatorSchema).min(2),
  joiner: z.string(),
  confidence: z.number().min(0).max(1),
});

const IdentityStrategyRowPositionSchema = z.object({
  kind: z.literal("rowPosition"),
  confidence: z.number().min(0).max(1),
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
  name: z.string().min(1),
});

const ByColumnIndexLocatorSchema = z.object({
  kind: z.literal("byColumnIndex"),
  col: z.number().int().min(1),
});

export const BindingSourceLocatorSchema = z.discriminatedUnion("kind", [
  ByHeaderNameLocatorSchema,
  ByColumnIndexLocatorSchema,
]);

export type BindingSourceLocator = z.infer<typeof BindingSourceLocatorSchema>;

// Shape of `FieldMapping.normalizedKey` — mirrors the regex enforced by
// `FieldMappingSchema` so the plan and the materialised row agree.
const NormalizedKeyPattern = /^[a-z][a-z0-9_]*$/;

export const ColumnBindingSchema = z.object({
  sourceLocator: BindingSourceLocatorSchema,
  columnDefinitionId: z.string().min(1),
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
});

export type ColumnBinding = z.infer<typeof ColumnBindingSchema>;
