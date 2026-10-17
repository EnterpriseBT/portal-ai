import { createHash } from "node:crypto";

import { describe, it, expect } from "@jest/globals";

import { PG_IDENTIFIER_MAX_BYTES } from "@portalai/core/contracts";

import {
  gistIndexName,
  sanitizeColumnName,
  trgmIndexName,
} from "../../services/wide-table-reconciler.service.js";

const ENTITY = "0b6c2a8e-6f1d-4c3a-9a51-2f7d8e4b1c90";

describe("gistIndexName (#804)", () => {
  it("fits Postgres's identifier limit for the longest column name", () => {
    const longest = sanitizeColumnName("k".repeat(58), new Set());
    const name = gistIndexName(ENTITY, longest);
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(
      PG_IDENTIFIER_MAX_BYTES
    );
  });

  it("is the same length whatever the column name", () => {
    expect(gistIndexName(ENTITY, "c_a")).toHaveLength(
      gistIndexName(ENTITY, "c_" + "x".repeat(61)).length
    );
  });

  it("distinguishes two columns sharing a long prefix", () => {
    // The pre-#804 name truncated both of these to the same 63 bytes.
    const a = gistIndexName(ENTITY, "c_parcel_boundary_polygon_a");
    const b = gistIndexName(ENTITY, "c_parcel_boundary_polygon_b");
    expect(a).not.toBe(b);
    expect(a.slice(0, PG_IDENTIFIER_MAX_BYTES)).not.toBe(
      b.slice(0, PG_IDENTIFIER_MAX_BYTES)
    );
  });

  it("is stable, prefixed by the table and suffixed _gist", () => {
    const name = gistIndexName(ENTITY, "c_boundary");
    expect(name).toBe(gistIndexName(ENTITY, "c_boundary"));
    expect(name.startsWith(`er__${ENTITY}__`)).toBe(true);
    expect(name.endsWith("_gist")).toBe(true);
  });

  it("uses the md5 prefix migration 0123 computes in SQL", () => {
    const md5 = createHash("md5").update("c_boundary").digest("hex");
    expect(gistIndexName(ENTITY, "c_boundary")).toBe(
      `er__${ENTITY}__${md5.slice(0, 16)}_gist`
    );
  });
});

describe("trgmIndexName (#649)", () => {
  it("is exactly 63 bytes for any column name", () => {
    const longest = sanitizeColumnName("k".repeat(58), new Set());
    expect(Buffer.byteLength(trgmIndexName(ENTITY, longest))).toBe(
      PG_IDENTIFIER_MAX_BYTES
    );
    expect(Buffer.byteLength(trgmIndexName(ENTITY, "c_a"))).toBe(
      PG_IDENTIFIER_MAX_BYTES
    );
  });

  it("distinguishes two columns sharing a long prefix", () => {
    expect(trgmIndexName(ENTITY, "c_parcel_owner_name_a")).not.toBe(
      trgmIndexName(ENTITY, "c_parcel_owner_name_b")
    );
  });

  it("shares gistIndexName's hash, with a _trgm suffix", () => {
    const gist = gistIndexName(ENTITY, "c_city");
    const trgm = trgmIndexName(ENTITY, "c_city");
    expect(trgm).toBe(gist.replace(/_gist$/, "_trgm"));
  });
});
