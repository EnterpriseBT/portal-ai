/**
 * Unit tests for the portal SQL response envelope helpers
 * (Phase 3 slice 0).
 */

import { describe, it, expect } from "@jest/globals";

import {
  applyRowCap,
  applyCellCap,
  buildResponse,
  PORTAL_SQL_DEFAULTS,
} from "../../services/portal-sql-response.util.js";

describe("applyRowCap", () => {
  it("returns the rows unchanged when below the cap", () => {
    const rows = [{ a: 1 }, { a: 2 }];
    const result = applyRowCap(rows, 500);
    expect(result.rows).toBe(rows);
    expect(result.capped).toBe(false);
    expect(result.totalCount).toBe(2);
  });

  it("slices to the first `cap` rows when over", () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({ a: i }));
    const result = applyRowCap(rows, 500);
    expect(result.rows).toHaveLength(500);
    expect(result.capped).toBe(true);
    expect(result.totalCount).toBe(600);
  });
});

describe("applyCellCap", () => {
  it("replaces an oversized string cell with the truncation marker", () => {
    const big = "x".repeat(1000);
    const rows = [{ a: 1, big }];
    const out = applyCellCap(rows, 500);
    expect(out[0]!.a).toBe(1);
    expect(out[0]!.big).toBe("…<truncated, original 1000b>");
  });

  it("replaces an oversized JSON cell when serialised to a long string", () => {
    const arr = Array.from({ length: 200 }, (_, i) => `id-${i}`);
    const rows = [{ tags: arr }];
    const out = applyCellCap(rows, 500);
    expect(out[0]!.tags).toMatch(/^…<truncated, original \d+b>$/);
  });

  it("leaves numeric / boolean / null cells untouched", () => {
    const rows = [{ n: 1, b: true, z: null }];
    const out = applyCellCap(rows, 1);
    expect(out[0]).toEqual({ n: 1, b: true, z: null });
  });
});

describe("buildResponse", () => {
  it("returns a plain envelope when no caps fire", () => {
    const env = buildResponse(
      [{ a: 1 }],
      1,
      false,
      null,
      PORTAL_SQL_DEFAULTS.rowCap,
      PORTAL_SQL_DEFAULTS.payloadCap,
      PORTAL_SQL_DEFAULTS.truncatedSampleSize
    );
    expect(env).toEqual({ rows: [{ a: 1 }], appliedLimit: null });
  });

  it("returns the row-cap envelope with hint when capped", () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ a: i }));
    const env = buildResponse(
      rows,
      600,
      true,
      501,
      PORTAL_SQL_DEFAULTS.rowCap,
      PORTAL_SQL_DEFAULTS.payloadCap,
      PORTAL_SQL_DEFAULTS.truncatedSampleSize
    );
    expect(env).toMatchObject({
      truncated: true,
      totalCount: 600,
      appliedLimit: 501,
    });
    expect((env as { hint: string }).hint).toContain("500 rows");
  });

  it("collapses to the payload-cap envelope when the row+cell envelope still exceeds the byte cap", () => {
    // 200 rows × 1 column × ~700 bytes per cell ≈ 140 KB — beyond the
    // 100 KB default payloadCap.
    const rows = Array.from({ length: 200 }, (_, i) => ({
      blob: "y".repeat(700),
      i,
    }));
    const env = buildResponse(
      rows,
      200,
      false,
      null,
      PORTAL_SQL_DEFAULTS.rowCap,
      PORTAL_SQL_DEFAULTS.payloadCap,
      PORTAL_SQL_DEFAULTS.truncatedSampleSize
    );
    expect((env as { truncated?: true }).truncated).toBe(true);
    const collapsed = env as {
      truncated: true;
      sample: unknown[];
      columnSizes: Record<string, number>;
      hint: string;
    };
    expect(collapsed.sample).toHaveLength(
      PORTAL_SQL_DEFAULTS.truncatedSampleSize
    );
    expect(collapsed.columnSizes).toHaveProperty("blob");
    expect(collapsed.hint).toContain("100000 bytes");
  });
});
