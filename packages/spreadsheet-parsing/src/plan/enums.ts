import { z } from "zod";

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

export const BINDING_SOURCE_KINDS = [
  "byHeaderName",
  "byPositionIndex",
] as const;
export const BindingSourceKindEnum = z.enum(BINDING_SOURCE_KINDS);
export type BindingSourceKind = z.infer<typeof BindingSourceKindEnum>;

export const LOCATOR_KINDS = ["cell", "range", "column", "row"] as const;
export const LocatorKindEnum = z.enum(LOCATOR_KINDS);
export type LocatorKind = z.infer<typeof LocatorKindEnum>;

export const SKIP_RULE_AXES = ["row", "column"] as const;
export const SkipRuleAxisEnum = z.enum(SKIP_RULE_AXES);
export type SkipRuleAxis = z.infer<typeof SkipRuleAxisEnum>;

/** Region axis membership: "row" = header is a row of cells; "column" = header is a column of cells. */
export const AXIS_MEMBERS = ["row", "column"] as const;
export const AxisMemberEnum = z.enum(AXIS_MEMBERS);
export type AxisMember = z.infer<typeof AxisMemberEnum>;

export const SEGMENT_KINDS = ["field", "pivot", "skip"] as const;
export const SegmentKindEnum = z.enum(SEGMENT_KINDS);
export type SegmentKind = z.infer<typeof SegmentKindEnum>;

export const TERMINATOR_KINDS = ["untilBlank", "matchesPattern"] as const;
export const TerminatorKindEnum = z.enum(TERMINATOR_KINDS);
export type TerminatorKind = z.infer<typeof TerminatorKindEnum>;

export const DRIFT_ACTIONS = ["halt", "auto-apply"] as const;
export const DriftActionEnum = z.enum(DRIFT_ACTIONS);
export type DriftAction = z.infer<typeof DriftActionEnum>;

export const DRIFT_SEVERITIES = ["none", "info", "warn", "blocker"] as const;
export const DriftSeverityEnum = z.enum(DRIFT_SEVERITIES);
export type DriftSeverity = z.infer<typeof DriftSeverityEnum>;

/** Default consecutive-blank count for `untilBlank` terminators. */
export const DEFAULT_UNTIL_BLANK_COUNT = 2;
