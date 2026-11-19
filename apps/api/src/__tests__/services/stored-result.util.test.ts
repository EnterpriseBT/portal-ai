import { describe, it, expect } from "@jest/globals";

import {
  describeStoredResult,
  isStoredResultSummary,
  stripStoredMessage,
  toStoredBlockContent,
  toStoredToolResult,
} from "../../services/stored-result.util.js";

// #1038: a stored portal message keeps the recipe that re-runs a result,
// never the result's rows. A result with no recipe isn't kept.

const pipeline = {
  sql: "SELECT name FROM contacts",
  stationId: "st-1",
  organizationId: "org-1",
};
const rows = [{ name: "Acme" }, { name: "Bolt" }, { name: "Cog" }];
const envelope = {
  queryHandle: "qh-1",
  rowCount: 3,
  schema: [{ name: "name", type: "text" }],
  samplePeek: rows,
  sampled: false,
  truncated: false,
  sql: "SELECT name FROM contacts",
};

describe("toStoredBlockContent", () => {
  it("keeps an inline table's recipe and columns, not its rows", () => {
    expect(
      toStoredBlockContent("data-table", {
        type: "data-table",
        columns: ["name"],
        rows,
        pipeline,
      })
    ).toEqual({ type: "data-table", columns: ["name"], pipeline });
  });

  it("keeps a handle table's recipe and metadata, not its handle or sample", () => {
    expect(
      toStoredBlockContent("data-table", {
        type: "data-table",
        ...envelope,
        pipeline,
      })
    ).toEqual({
      type: "data-table",
      rowCount: 3,
      schema: [{ name: "name", type: "text" }],
      sampled: false,
      truncated: false,
      sql: "SELECT name FROM contacts",
      pipeline,
    });
  });

  it("keeps a chart's program and recipe, not its rows", () => {
    expect(
      toStoredBlockContent("d3", {
        type: "d3",
        program: "api.d3;",
        title: "Names",
        rows,
        pipeline,
      })
    ).toEqual({ type: "d3", program: "api.d3;", title: "Names", pipeline });
  });

  it("keeps a map's spec and recipe, not its rows", () => {
    const spec = { layers: [] };
    expect(
      toStoredBlockContent("geo", { type: "geo", spec, rows, pipeline })
    ).toEqual({ type: "geo", spec, pipeline });
  });

  it("stores a table with no recipe as not kept, with columns from its columns", () => {
    expect(
      toStoredBlockContent("data-table", {
        type: "data-table",
        columns: ["name"],
        rows,
      })
    ).toEqual({
      type: "data-table",
      notKept: true,
      columns: ["name"],
      rowCount: 3,
    });
  });

  it("derives a not-kept result's columns from its schema, then its rows", () => {
    expect(
      toStoredBlockContent("data-table", { type: "data-table", ...envelope })
    ).toEqual({
      type: "data-table",
      notKept: true,
      columns: ["name"],
      rowCount: 3,
    });
    expect(toStoredBlockContent("data-table", { rows })).toEqual({
      type: "data-table",
      notKept: true,
      columns: ["name"],
      rowCount: 3,
    });
  });

  it("treats a malformed pipeline as no recipe", () => {
    expect(
      toStoredBlockContent("data-table", {
        rows,
        pipeline: { sql: "" },
      })
    ).toMatchObject({ notKept: true });
  });

  it("is idempotent", () => {
    const stored = toStoredBlockContent("data-table", {
      type: "data-table",
      columns: ["name"],
      rows,
      pipeline,
    });
    expect(toStoredBlockContent("data-table", stored)).toEqual(stored);
    const notKept = toStoredBlockContent("data-table", { rows });
    expect(toStoredBlockContent("data-table", notKept)).toEqual(notKept);
  });
});

describe("toStoredToolResult", () => {
  it("keeps a row result's columns, count and query, not its rows", () => {
    expect(toStoredToolResult({ rows, pipeline })).toEqual({
      rowsNotKept: true,
      columns: ["name"],
      rowCount: 3,
      sql: pipeline.sql,
    });
  });

  it("summarizes a handle envelope and a bare row array", () => {
    expect(toStoredToolResult({ type: "data-table", ...envelope })).toEqual({
      rowsNotKept: true,
      columns: ["name"],
      rowCount: 3,
      sql: envelope.sql,
    });
    expect(toStoredToolResult(rows)).toEqual({
      rowsNotKept: true,
      columns: ["name"],
      rowCount: 3,
    });
  });

  it("passes a scalar result through, and is idempotent", () => {
    const scalar = { success: true, entityId: "e-1" };
    expect(toStoredToolResult(scalar)).toBe(scalar);
    const summary = toStoredToolResult({ rows });
    expect(toStoredToolResult(summary)).toEqual(summary);
    expect(isStoredResultSummary(summary)).toBe(true);
    expect(isStoredResultSummary(scalar)).toBe(false);
  });

  it("describes a summary for the model with no row values", () => {
    const text = describeStoredResult(
      "sql_query",
      toStoredToolResult({ rows, pipeline }) as never
    );
    expect(text).toBe(
      "[Previous sql_query result: 3 rows, columns: [name]. Its rows aren't kept; re-run the query to see values.]"
    );
    expect(text).not.toContain("Acme");
  });
});

describe("stripStoredMessage", () => {
  it("strips every result block and tool result, leaving other blocks", () => {
    const message = {
      id: "m-1",
      blocks: [
        { type: "text", content: "Here are the contacts." },
        { type: "tool-result", toolName: "sql_query", content: { rows } },
        {
          type: "data-table",
          content: { type: "data-table", columns: ["name"], rows, pipeline },
        },
      ],
    };
    const stripped = stripStoredMessage(message);
    expect(stripped.blocks).toEqual([
      { type: "text", content: "Here are the contacts." },
      {
        type: "tool-result",
        toolName: "sql_query",
        content: { rowsNotKept: true, columns: ["name"], rowCount: 3 },
      },
      {
        type: "data-table",
        content: { type: "data-table", columns: ["name"], pipeline },
      },
    ]);
    expect(JSON.stringify(stripped)).not.toContain("Acme");
  });
});
