import { z } from "zod";

import { DriftActionEnum, DriftSeverityEnum } from "./enums.js";

export const DriftKnobsSchema = z.object({
  headerShiftRows: z.number().int().min(0).default(0),
  addedColumns: DriftActionEnum.default("halt"),
  removedColumns: z.object({
    max: z.number().int().min(0),
    action: DriftActionEnum.default("halt"),
  }),
});

export type DriftKnobs = z.infer<typeof DriftKnobsSchema>;

/**
 * Drift kinds emitted by `replay()`; extendable as new drift classes land.
 */
export const DRIFT_KINDS = [
  "header-shifted",
  "added-columns",
  "removed-columns",
  "bounds-overflow",
  "records-axis-value-renamed",
  "identity-column-has-blanks",
  "duplicate-identity-values",
] as const;
export const DriftKindEnum = z.enum(DRIFT_KINDS);
export type DriftKind = z.infer<typeof DriftKindEnum>;

export const RegionDriftSchema = z.object({
  regionId: z.string().min(1),
  kinds: z.array(DriftKindEnum),
  details: z.unknown().optional(),
  withinTolerance: z.boolean(),
});

export type RegionDrift = z.infer<typeof RegionDriftSchema>;

export const DriftReportSchema = z.object({
  regionDrifts: z.array(RegionDriftSchema),
  severity: DriftSeverityEnum,
  identityChanging: z.boolean(),
});

export type DriftReport = z.infer<typeof DriftReportSchema>;
