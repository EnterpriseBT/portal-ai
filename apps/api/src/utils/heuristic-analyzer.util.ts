/**
 * Heuristic column/entity analyzer — regex-based type inference and
 * column definition matching used as a fallback when AI analysis is
 * unavailable or fails.
 *
 * Every column maps to an existing column definition ID. Matching is
 * attempted in order: exact key/label → pattern-based → type-based fallback.
 */

import type {
  FileUploadRecommendationEntity,
  ColumnStat,
} from "@portalai/core/models";

import type { AnalyzeFileInput, ExistingColumnDefinition } from "../services/file-analysis.service.js";

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
const PHONE_PATTERN = /^\+?[\d\s\-().]+$/;

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
// Pattern-based matching
// ---------------------------------------------------------------------------

/**
 * Attempt to match a column to a known column definition by sample value
 * patterns (e.g. email regex → "email" def, UUID regex → "uuid" def).
 * Returns the matching definition or null.
 */
function matchByPattern(
  sampleValues: string[],
  existingByKey: Map<string, ExistingColumnDefinition>,
): ExistingColumnDefinition | null {
  const nonEmpty = sampleValues.filter((v) => v.trim() !== "");
  if (nonEmpty.length === 0) return null;

  if (nonEmpty.every((v) => EMAIL_PATTERN.test(v))) {
    return existingByKey.get("email") ?? null;
  }
  if (nonEmpty.every((v) => UUID_PATTERN.test(v))) {
    return existingByKey.get("uuid") ?? null;
  }
  if (nonEmpty.every((v) => URL_PATTERN.test(v))) {
    return existingByKey.get("url") ?? null;
  }
  // Phone pattern: require at least one phone-specific char (+, parens, spaces between digits)
  // but exclude date-like patterns (YYYY-MM-DD)
  if (
    nonEmpty.every((v) => PHONE_PATTERN.test(v)) &&
    nonEmpty.some((v) => /[+()]/.test(v) || /\d\s\d/.test(v)) &&
    !nonEmpty.every((v) => DATE_PATTERNS.some((p) => p.test(v)))
  ) {
    return existingByKey.get("phone") ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Type-based fallback matching
// ---------------------------------------------------------------------------

/** Maps inferred type to the seed column definition key to use as fallback. */
function typeFallbackKey(inferredType: string, sampleValues: string[]): string {
  switch (inferredType) {
    case "boolean": return "boolean";
    case "date": return "date";
    case "datetime": return "datetime";
    case "number": {
      // Check if samples contain decimals
      const nonEmpty = sampleValues.filter((v) => v.trim() !== "");
      const hasDecimals = nonEmpty.some((v) => v.includes("."));
      return hasDecimals ? "decimal" : "integer";
    }
    case "string":
    default:
      return "text";
  }
}

// ---------------------------------------------------------------------------
// Heuristic analysis
// ---------------------------------------------------------------------------

export function heuristicAnalyze(input: AnalyzeFileInput): FileUploadRecommendationEntity {
  const { parseResult, existingColumns } = input;

  // Build lookup maps for existing columns
  const existingByKey = new Map(existingColumns.map((c) => [c.key, c]));
  const existingByLabel = new Map(existingColumns.map((c) => [c.label.toLowerCase(), c]));

  const columns = parseResult.columnStats.map((stat: ColumnStat) => {
    const normalizedKey = toSnakeCase(stat.name);
    const { type: inferredType, format } = inferType(stat.sampleValues);

    const baseResult = {
      sourceField: stat.name,
      format,
      isPrimaryKey: false,
      required: stat.nullRate === 0,
      sampleValues: stat.sampleValues,
      normalizedKey,
      defaultValue: null,
      enumValues: null,
    };

    // 1. Exact key/label match → confidence 1.0
    const exactKeyMatch = existingByKey.get(normalizedKey);
    const exactLabelMatch = existingByLabel.get(stat.name.toLowerCase());
    const exactMatch = exactKeyMatch || exactLabelMatch;

    if (exactMatch) {
      return {
        ...baseResult,
        existingColumnDefinitionId: exactMatch.id,
        existingColumnDefinitionKey: exactMatch.key,
        confidence: 1,
        normalizedKey: exactMatch.key,
      };
    }

    // 2. Pattern-based match (email, UUID, URL, phone) → confidence 0.9
    const patternMatch = matchByPattern(stat.sampleValues, existingByKey);
    if (patternMatch) {
      return {
        ...baseResult,
        existingColumnDefinitionId: patternMatch.id,
        existingColumnDefinitionKey: patternMatch.key,
        confidence: 0.9,
      };
    }

    // 3. Type-based fallback → confidence 0.5
    const fallbackKey = typeFallbackKey(inferredType, stat.sampleValues);
    const fallbackDef = existingByKey.get(fallbackKey);
    if (fallbackDef) {
      return {
        ...baseResult,
        existingColumnDefinitionId: fallbackDef.id,
        existingColumnDefinitionKey: fallbackDef.key,
        confidence: 0.5,
      };
    }

    // 4. Last resort — pick "text" if available, otherwise first string-type def
    const textDef = existingByKey.get("text");
    if (textDef) {
      return {
        ...baseResult,
        existingColumnDefinitionId: textDef.id,
        existingColumnDefinitionKey: textDef.key,
        confidence: 0.5,
      };
    }

    // Absolute fallback: use the first existing column definition
    const firstDef = existingColumns[0];
    return {
      ...baseResult,
      existingColumnDefinitionId: firstDef?.id ?? "",
      existingColumnDefinitionKey: firstDef?.key ?? "",
      confidence: 0,
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
