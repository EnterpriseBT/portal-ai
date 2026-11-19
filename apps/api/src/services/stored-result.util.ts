/**
 * #1038: what a portal message keeps of a result. Rows are never stored:
 *
 * - A table, chart or map block keeps the recipe that re-runs it (its
 *   `pipeline`) and what it showed (columns, program, spec, title). The
 *   widget re-runs the recipe as its reader, so a reader who lost access to
 *   the data behind it sees "no longer available", never a stored copy.
 * - A block with no recipe isn't kept: it becomes `{ notKept, columns,
 *   rowCount }` (`NotKeptContentSchema`).
 * - A raw `tool-result` (the model's history) keeps a row result's columns,
 *   count, query and handle id, not its rows. A bare array counts as rows
 *   only when every element is an object (a custom tool may return its data
 *   that way); a list of ids or names passes through, as do other results.
 *
 * Applied where a message is persisted (`handleToolResult`) and where one is
 * served (`getPortal`, `replayTurn`), so a message stored before this change
 * never leaves the API with rows either. Every function is idempotent.
 */

import { VizPipelineSchema } from "@portalai/core/contracts";

/** The display blocks that draw rows. The migration (0136) names them too. */
export const RESULT_BLOCK_TYPES: ReadonlySet<string> = new Set([
  "data-table",
  "d3",
  "geo",
]);

/** Content keys that hold row values (or a handle to them). */
const ROW_KEYS = new Set(["rows", "samplePeek", "sample", "queryHandle"]);

type Row = Record<string, unknown>;

/** A tool result's stored form: its shape, not its values. */
export interface StoredResultSummary {
  rowsNotKept: true;
  columns: string[];
  rowCount: number;
  sql?: string;
  /** The staged handle's id: not data. Its reads re-check access (#1038). */
  queryHandle?: string;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rowsOf(content: Record<string, unknown>): Row[] | null {
  if (Array.isArray(content.rows)) return content.rows as Row[];
  if (Array.isArray(content.sample)) return content.sample as Row[];
  return null;
}

/** The columns a result showed: declared, else its schema's, else its rows'. */
function columnsOf(content: Record<string, unknown>): string[] {
  if (Array.isArray(content.columns)) return content.columns as string[];
  if (Array.isArray(content.schema)) {
    return (content.schema as Array<{ name?: unknown }>)
      .map((c) => c?.name)
      .filter((n): n is string => typeof n === "string");
  }
  const rows = rowsOf(content) ?? (content.samplePeek as Row[] | undefined);
  const first = Array.isArray(rows) ? rows[0] : undefined;
  return first != null && typeof first === "object" ? Object.keys(first) : [];
}

function rowCountOf(content: Record<string, unknown>): number {
  if (typeof content.rowCount === "number") return content.rowCount;
  return rowsOf(content)?.length ?? 0;
}

function withoutRows(
  content: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(content).filter(([key]) => !ROW_KEYS.has(key))
  );
}

/** The persisted form of a `data-table` / `d3` / `geo` block's content. */
export function toStoredBlockContent(
  type: string,
  content: unknown
): Record<string, unknown> {
  const obj = asObject(content) ?? {};
  if (obj.notKept === true) return obj;
  if (VizPipelineSchema.safeParse(obj.pipeline).success) {
    return withoutRows(obj);
  }
  return {
    type,
    notKept: true,
    columns: columnsOf(obj),
    rowCount: rowCountOf(obj),
  };
}

export function isStoredResultSummary(
  content: unknown
): content is StoredResultSummary {
  return asObject(content)?.rowsNotKept === true;
}

function isRowArray(content: unknown): content is Row[] {
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((item) => asObject(item) != null)
  );
}

/** The persisted form of a raw tool result: a row result's shape only. */
export function toStoredToolResult(content: unknown): unknown {
  if (isRowArray(content)) {
    return {
      rowsNotKept: true,
      columns: Object.keys(content[0]),
      rowCount: content.length,
    } satisfies StoredResultSummary;
  }
  const obj = asObject(content);
  if (obj == null || isStoredResultSummary(obj)) return content;
  const hasRows = rowsOf(obj) != null || typeof obj.queryHandle === "string";
  if (!hasRows) return content;
  const pipelineSql = asObject(obj.pipeline)?.sql;
  const sql =
    typeof pipelineSql === "string"
      ? pipelineSql
      : typeof obj.sql === "string"
        ? obj.sql
        : undefined;
  return {
    rowsNotKept: true,
    columns: columnsOf(obj),
    rowCount: rowCountOf(obj),
    ...(sql ? { sql } : {}),
    ...(typeof obj.queryHandle === "string"
      ? { queryHandle: obj.queryHandle }
      : {}),
  } satisfies StoredResultSummary;
}

/** How the model's history names an earlier row result (no values). */
export function describeStoredResult(
  toolName: string,
  summary: StoredResultSummary
): string {
  const reuse = summary.queryHandle
    ? `pass its queryHandle ${summary.queryHandle} while it's still live, or `
    : "";
  return (
    `[Previous ${toolName} result: ${summary.rowCount} rows, ` +
    `columns: [${summary.columns.join(", ")}]. ` +
    `Its rows aren't kept; ${reuse}re-run the query to see values.]`
  );
}

/** A stored message with every result block and tool result stripped. */
export function stripStoredMessage<M extends { blocks: unknown }>(
  message: M
): M {
  if (!Array.isArray(message.blocks)) return message;
  const blocks = (message.blocks as Array<Record<string, unknown>>).map(
    (block) => {
      if (block == null || typeof block !== "object") return block;
      const type = block.type as string;
      if (RESULT_BLOCK_TYPES.has(type)) {
        return { ...block, content: toStoredBlockContent(type, block.content) };
      }
      if (type === "tool-result") {
        return { ...block, content: toStoredToolResult(block.content) };
      }
      return block;
    }
  );
  return { ...message, blocks };
}
