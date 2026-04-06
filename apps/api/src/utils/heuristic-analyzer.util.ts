/**
 * Heuristic column/entity analyzer — regex-based type inference and
 * exact-match column mapping used as a fallback when AI analysis is
 * unavailable or fails.
 */

import type {
  FileUploadRecommendationEntity,
  ColumnStat,
} from "@portalai/core/models";

import type { AnalyzeFileInput } from "../services/file-analysis.service.js";

// ---------------------------------------------------------------------------
// Type inference patterns
// ---------------------------------------------------------------------------

const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}$/,
  /^\d{2}\/\d{2}\/\d{4}$/,
  /^\d{2}-\d{2}-\d{4}$/,
  /^\d{4}\/\d{2}\/\d{2}$/,
];

const DATETIME_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/,
  /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/,
];

const NUMBER_PATTERN = /^-?[\d,]+\.?\d*$/;
const BOOLEAN_PATTERN = /^(true|false|yes|no|0|1)$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_PATTERN = /^https?:\/\/[^\s]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function inferType(sampleValues: string[]): { type: string; format: string | null; canonicalFormat: string | null } {
  const nonEmpty = sampleValues.filter((v) => v.trim() !== "");
  if (nonEmpty.length === 0) return { type: "string", format: null, canonicalFormat: null };

  // Check datetime before date (more specific first)
  if (nonEmpty.every((v) => DATETIME_PATTERNS.some((p) => p.test(v)))) {
    return { type: "datetime", format: "ISO8601", canonicalFormat: "ISO8601" };
  }

  if (nonEmpty.every((v) => DATE_PATTERNS.some((p) => p.test(v)))) {
    return { type: "date", format: "YYYY-MM-DD", canonicalFormat: "YYYY-MM-DD" };
  }

  if (nonEmpty.every((v) => BOOLEAN_PATTERN.test(v))) {
    return { type: "boolean", format: null, canonicalFormat: null };
  }

  if (nonEmpty.every((v) => NUMBER_PATTERN.test(v.replace(/,/g, "")))) {
    return { type: "number", format: null, canonicalFormat: null };
  }

  if (nonEmpty.every((v) => EMAIL_PATTERN.test(v))) {
    return { type: "string", format: "email", canonicalFormat: "lowercase" };
  }

  return { type: "string", format: null, canonicalFormat: null };
}

/**
 * Detect a validation pattern from sample values.
 * Returns a regex string if a known pattern is detected, otherwise null.
 */
export function detectValidationPattern(sampleValues: string[]): string | null {
  const nonEmpty = sampleValues.filter((v) => v.trim() !== "");
  if (nonEmpty.length === 0) return null;

  if (nonEmpty.every((v) => EMAIL_PATTERN.test(v))) {
    return "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";
  }
  if (nonEmpty.every((v) => URL_PATTERN.test(v))) {
    return "^https?://[^\\s]+$";
  }
  if (nonEmpty.every((v) => UUID_PATTERN.test(v))) {
    return "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
  }
  return null;
}

export function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s\-.]+/g, "_")
    .replace(/[^a-z0-9_]/gi, "")
    .toLowerCase()
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    || "column";
}

// ---------------------------------------------------------------------------
// Heuristic analysis
// ---------------------------------------------------------------------------

type ColumnType = FileUploadRecommendationEntity["columns"][number]["type"];

export function heuristicAnalyze(input: AnalyzeFileInput): FileUploadRecommendationEntity {
  const { parseResult, existingColumns, priorRecommendations } = input;

  // Build lookup maps for existing columns
  const existingByKey = new Map(existingColumns.map((c) => [c.key, c]));
  const existingByLabel = new Map(existingColumns.map((c) => [c.label.toLowerCase(), c]));

  // Build lookup for prior recommended columns (to support cross-file matching)
  const priorColumnKeys = new Set<string>();
  for (const entity of priorRecommendations) {
    for (const col of entity.columns) {
      priorColumnKeys.add(col.key);
    }
  }

  const columns = parseResult.columnStats.map((stat: ColumnStat) => {
    const key = toSnakeCase(stat.name);
    const { type, format, canonicalFormat } = inferType(stat.sampleValues);
    const validationPattern = detectValidationPattern(stat.sampleValues);

    // Try exact match against existing column definitions
    const exactKeyMatch = existingByKey.get(key);
    const exactLabelMatch = existingByLabel.get(stat.name.toLowerCase());
    const existingMatch = exactKeyMatch || exactLabelMatch;

    // Check if this column key was recommended in a prior file
    const matchesPrior = priorColumnKeys.has(key);

    const baseFields = {
      normalizedKey: key,
      defaultValue: null,
      enumValues: null,
      validationPattern,
      canonicalFormat,
    };

    if (existingMatch) {
      return {
        sourceField: stat.name,
        key: existingMatch.key,
        label: existingMatch.label,
        type: existingMatch.type as ColumnType,
        format,
        isPrimaryKey: false,
        required: stat.nullRate === 0,
        action: "match_existing" as const,
        existingColumnDefinitionId: existingMatch.id,
        confidence: 1,
        sampleValues: stat.sampleValues,
        ...baseFields,
        normalizedKey: existingMatch.key,
      };
    }

    if (matchesPrior) {
      return {
        sourceField: stat.name,
        key,
        label: stat.name,
        type: type as ColumnType,
        format,
        isPrimaryKey: false,
        required: stat.nullRate === 0,
        action: "match_existing" as const,
        existingColumnDefinitionId: null,
        confidence: 0.9,
        sampleValues: stat.sampleValues,
        ...baseFields,
      };
    }

    return {
      sourceField: stat.name,
      key,
      label: stat.name,
      type: type as ColumnType,
      format,
      isPrimaryKey: false,
      required: stat.nullRate === 0,
      action: "create_new" as const,
      existingColumnDefinitionId: null,
      confidence: 0,
      sampleValues: stat.sampleValues,
      ...baseFields,
    };
  });

  // Derive entity key from file name (strip extension)
  const entityKey = toSnakeCase(parseResult.fileName.replace(/\.[^.]+$/, ""));
  const entityLabel = parseResult.fileName.replace(/\.[^.]+$/, "");

  return {
    entityKey,
    entityLabel,
    sourceFileName: parseResult.fileName,
    columns,
  };
}
