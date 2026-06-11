/**
 * Value-shaping helpers for `bulk_transform`'s `writes[]` mapping
 * (#99 slice 1). Pure functions with no production consumers yet —
 * slice 4 wires them into the processor's per-batch loop.
 *
 * Two exports:
 * - `getByPath(value, path)` — Lodash-style single-value read into
 *   any JSON-serializable shape (primitive/object/array/nested).
 *   Supports dot segments, bracket indices, and mixed. Returns
 *   `undefined` for any missing key or out-of-bounds index.
 *   Empty path resolves to the whole value.
 * - `shapeWritesForRecord(writes, toolResult, sourceRow, sqlAliasValues)`
 *   — resolves each write's `valueFrom` and groups the resulting
 *   per-record values by `targetConnectorEntityId`.
 */

import type {
  BulkTransformWrite,
  BulkTransformValueFrom,
} from "@portalai/core/models";

/** Internal: tokenize a Lodash-style path into segment strings. */
function tokenizePath(path: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let i = 0;
  while (i < path.length) {
    const c = path[i];
    if (c === ".") {
      if (current !== "") {
        tokens.push(current);
        current = "";
      }
      i++;
      continue;
    }
    if (c === "[") {
      if (current !== "") {
        tokens.push(current);
        current = "";
      }
      const close = path.indexOf("]", i);
      if (close === -1) {
        throw new Error(`Unterminated '[' in path: ${path}`);
      }
      tokens.push(path.slice(i + 1, close));
      i = close + 1;
      continue;
    }
    current += c;
    i++;
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

export function getByPath(value: unknown, path: string): unknown {
  if (path === "") return value;
  const tokens = tokenizePath(path);
  let acc: unknown = value;
  for (const tok of tokens) {
    if (acc === null || acc === undefined) return undefined;
    if (typeof acc !== "object") return undefined;
    acc = (acc as Record<string, unknown>)[tok];
  }
  return acc;
}

function resolveValueFrom(
  vf: BulkTransformValueFrom,
  toolResult: unknown,
  sourceRow: Record<string, unknown>,
  sqlAliasValues: Record<string, unknown> | null
): unknown {
  switch (vf.kind) {
    case "tool_result":
      // Defensive guard: a tool_result write demands an actual tool
      // result. A `null` here means the caller (the SQL branch, or a
      // bug) didn't supply one — pre-flight (slice 2) should have
      // rejected this combination, so reaching here is a contract
      // violation worth surfacing.
      if (toolResult === null) {
        throw new Error(
          "shapeWritesForRecord: 'tool_result' write requested but no tool result was provided"
        );
      }
      return toolResult;
    case "tool_path":
      // Permissive: getByPath returns undefined for missing keys or
      // walking into null. A tool that legitimately returned null
      // yields undefined for any non-empty path — that's the right
      // signal that the path didn't find anything.
      return getByPath(toolResult, vf.path);
    case "sql_alias":
      return sqlAliasValues?.[vf.alias];
    case "source_column":
      return sourceRow[vf.column];
    case "constant":
      return vf.value;
  }
}

export function shapeWritesForRecord(
  writes: BulkTransformWrite[],
  toolResult: unknown,
  sourceRow: Record<string, unknown>,
  sqlAliasValues: Record<string, unknown> | null
): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const write of writes) {
    const value = resolveValueFrom(
      write.valueFrom,
      toolResult,
      sourceRow,
      sqlAliasValues
    );
    let bucket = result.get(write.targetConnectorEntityId);
    if (!bucket) {
      bucket = {};
      result.set(write.targetConnectorEntityId, bucket);
    }
    bucket[write.column] = value;
  }
  return result;
}
