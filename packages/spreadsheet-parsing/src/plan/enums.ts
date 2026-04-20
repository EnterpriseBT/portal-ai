import { z } from "zod";

export const ORIENTATIONS = [
  "rows-as-records",
  "columns-as-records",
  "cells-as-records",
] as const;
export const OrientationEnum = z.enum(ORIENTATIONS);
export type Orientation = z.infer<typeof OrientationEnum>;

export const HEADER_AXES = ["row", "column", "none"] as const;
export const HeaderAxisEnum = z.enum(HEADER_AXES);
export type HeaderAxis = z.infer<typeof HeaderAxisEnum>;

export const BOUNDS_MODES = [
  "absolute",
  "untilEmpty",
  "matchesPattern",
] as const;
export const BoundsModeEnum = z.enum(BOUNDS_MODES);
export type BoundsMode = z.infer<typeof BoundsModeEnum>;

export const AXIS_NAME_SOURCES = ["user", "ai", "anchor-cell"] as const;
export const AxisNameSourceEnum = z.enum(AXIS_NAME_SOURCES);
export type AxisNameSource = z.infer<typeof AxisNameSourceEnum>;

export const HEADER_STRATEGY_KINDS = ["row", "column", "rowLabels"] as const;
export const HeaderStrategyKindEnum = z.enum(HEADER_STRATEGY_KINDS);
export type HeaderStrategyKind = z.infer<typeof HeaderStrategyKindEnum>;

export const IDENTITY_STRATEGY_KINDS = [
  "column",
  "composite",
  "rowPosition",
] as const;
export const IdentityStrategyKindEnum = z.enum(IDENTITY_STRATEGY_KINDS);
export type IdentityStrategyKind = z.infer<typeof IdentityStrategyKindEnum>;

export const BINDING_SOURCE_KINDS = ["byHeaderName", "byColumnIndex"] as const;
export const BindingSourceKindEnum = z.enum(BINDING_SOURCE_KINDS);
export type BindingSourceKind = z.infer<typeof BindingSourceKindEnum>;

export const LOCATOR_KINDS = ["cell", "range", "column", "row"] as const;
export const LocatorKindEnum = z.enum(LOCATOR_KINDS);
export type LocatorKind = z.infer<typeof LocatorKindEnum>;

export const SKIP_RULE_AXES = ["row", "column"] as const;
export const SkipRuleAxisEnum = z.enum(SKIP_RULE_AXES);
export type SkipRuleAxis = z.infer<typeof SkipRuleAxisEnum>;

export const DRIFT_ACTIONS = ["halt", "auto-apply"] as const;
export const DriftActionEnum = z.enum(DRIFT_ACTIONS);
export type DriftAction = z.infer<typeof DriftActionEnum>;

export const DRIFT_SEVERITIES = ["none", "info", "warn", "blocker"] as const;
export const DriftSeverityEnum = z.enum(DRIFT_SEVERITIES);
export type DriftSeverity = z.infer<typeof DriftSeverityEnum>;

/** Consecutive unskippable blank records that terminate an `untilEmpty` region. */
export const DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT = 2;
