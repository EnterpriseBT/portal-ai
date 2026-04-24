import { z } from "zod";

export const WARNING_CODES = [
  "AMBIGUOUS_HEADER",
  "MULTIPLE_HEADER_CANDIDATES",
  "MIXED_COLUMN_TYPES",
  "DUPLICATE_IDENTITY_VALUES",
  "IDENTITY_COLUMN_HAS_BLANKS",
  "UNRECOGNIZED_COLUMN",
  "REGION_BOUNDS_UNCERTAIN",
  "BOUNDS_OVERFLOW",
  "SHEET_MAY_BE_NON_DATA",
  "SEGMENT_MISSING_AXIS_NAME",
  "CELL_VALUE_FIELD_NOT_BOUND",
  "ROW_POSITION_IDENTITY",
  "UNSUPPORTED_LAYOUT_SHAPE",
  "RECORDS_AXIS_VALUE_RENAMED",
  "DUPLICATE_ENTITY_TARGET",
] as const;

export const WarningCodeEnum = z.enum(WARNING_CODES);
export type WarningCode = (typeof WARNING_CODES)[number];

/**
 * Ergonomic const-object accessor so consumers can write
 * `WarningCode.AMBIGUOUS_HEADER` instead of a string literal. The `WarningCode`
 * identifier is both a type (union of literals) and a const value — TypeScript
 * declaration merging; ESLint's `no-redeclare` is overly strict here.
 */
// eslint-disable-next-line no-redeclare
export const WarningCode: { [K in WarningCode]: K } = WARNING_CODES.reduce(
  (acc, code) => {
    (acc as Record<string, string>)[code] = code;
    return acc;
  },
  {} as { [K in WarningCode]: K }
);

export const WARNING_SEVERITIES = ["info", "warn", "blocker"] as const;
export const WarningSeverityEnum = z.enum(WARNING_SEVERITIES);
export type WarningSeverity = (typeof WARNING_SEVERITIES)[number];

/**
 * Module-level default severity for each warning code. Consumers may override
 * via a `WarningPolicy` at the UI layer, but the parser itself emits with
 * these defaults.
 */
export const DEFAULT_WARNING_SEVERITY: Record<WarningCode, WarningSeverity> = {
  AMBIGUOUS_HEADER: "warn",
  MULTIPLE_HEADER_CANDIDATES: "warn",
  MIXED_COLUMN_TYPES: "info",
  DUPLICATE_IDENTITY_VALUES: "blocker",
  IDENTITY_COLUMN_HAS_BLANKS: "warn",
  UNRECOGNIZED_COLUMN: "info",
  REGION_BOUNDS_UNCERTAIN: "warn",
  BOUNDS_OVERFLOW: "warn",
  SHEET_MAY_BE_NON_DATA: "info",
  SEGMENT_MISSING_AXIS_NAME: "blocker",
  CELL_VALUE_FIELD_NOT_BOUND: "warn",
  ROW_POSITION_IDENTITY: "warn",
  UNSUPPORTED_LAYOUT_SHAPE: "blocker",
  RECORDS_AXIS_VALUE_RENAMED: "warn",
  DUPLICATE_ENTITY_TARGET: "blocker",
};
