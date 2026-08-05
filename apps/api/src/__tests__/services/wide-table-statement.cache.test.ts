import { describe, it, expect } from "@jest/globals";

import {
  writePlaceholderExpr,
  WideTableStatementCache,
} from "../../services/wide-table-statement.cache.js";

// ── writePlaceholderExpr (#316) ──────────────────────────────────────

describe("writePlaceholderExpr", () => {
  it("wraps a geometry placeholder to parse + constrain + repair GeoJSON", () => {
    expect(writePlaceholderExpr("geometry(Geometry, 4326)", 1)).toBe(
      "ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))"
    );
  });

  it("wraps regardless of the geometry modifiers (matches on the type prefix)", () => {
    expect(writePlaceholderExpr("geometry", 7)).toBe(
      "ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326))"
    );
  });

  it.each([
    "text",
    "numeric",
    "boolean",
    "date",
    "timestamptz",
    "jsonb",
    "text[]",
  ])("leaves a %s placeholder bare", (pgType) => {
    expect(writePlaceholderExpr(pgType, 3)).toBe("$3");
  });
});

// ── Read/write projection for geometry columns (#316) ────────────────

describe("WideTableStatementCache geometry projection", () => {
  const ENTITY = "ent-geo";
  const GEOM_COL = "c_boundary";
  const NUM_COL = "c_amount";

  // Two live columns: one geometry, one numeric. The cache reads them from
  // the columns repo and joins normalized keys from the mappings repo.
  const columnsRepo = {
    findByConnectorEntityId: async () => [
      {
        columnName: NUM_COL,
        pgType: "numeric",
        fieldMappingId: "fm-num",
        columnDefinitionId: "cd-num",
        connectorEntityId: ENTITY,
        retiredAt: null,
      },
      {
        columnName: GEOM_COL,
        pgType: "geometry(Geometry, 4326)",
        fieldMappingId: "fm-geo",
        columnDefinitionId: "cd-geo",
        connectorEntityId: ENTITY,
        retiredAt: null,
      },
    ],
  } as never;
  const mappingsRepo = {
    findByConnectorEntityId: async () => [
      { id: "fm-num", normalizedKey: "amount" },
      { id: "fm-geo", normalizedKey: "boundary" },
    ],
  } as never;

  const buildCache = () =>
    new WideTableStatementCache(columnsRepo, mappingsRepo);

  it("projects a geometry column as ST_AsGeoJSON in selectAllSql, others bare", async () => {
    const stmt = await buildCache().get(ENTITY);
    expect(stmt.selectAllSql).toContain(
      `ST_AsGeoJSON("${GEOM_COL}")::jsonb AS "${GEOM_COL}"`
    );
    // The numeric column is projected by bare name, not wrapped.
    expect(stmt.selectAllSql).toContain(`"${NUM_COL}"`);
    expect(stmt.selectAllSql).not.toContain(`ST_AsGeoJSON("${NUM_COL}")`);
  });

  it("wraps the geometry placeholder in the INSERT template, leaves others bare", async () => {
    const stmt = await buildCache().get(ENTITY);
    expect(stmt.insertSqlTemplate).toContain("ST_GeomFromGeoJSON($");
    expect(stmt.insertSqlTemplate).toContain(
      "ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON("
    );
  });

  it("emits ST_AsGeoJSON for a geometry value inside normalizedDataJsonbExpr", async () => {
    const stmt = await buildCache().get(ENTITY);
    const expr = stmt.normalizedDataJsonbExpr("w");
    expect(expr).toContain(`ST_AsGeoJSON("w"."${GEOM_COL}")::jsonb`);
    // The numeric column value is a plain reference.
    expect(expr).toContain(`"w"."${NUM_COL}"`);
  });

  it("wraps the geometry placeholder in a bulk INSERT too", async () => {
    const sql = await buildCache().buildBulkInsertSql(ENTITY, 2);
    // Two rows → two geometry wraps.
    const matches = sql.match(/ST_GeomFromGeoJSON\(\$\d+\)/g) ?? [];
    expect(matches).toHaveLength(2);
  });
});
