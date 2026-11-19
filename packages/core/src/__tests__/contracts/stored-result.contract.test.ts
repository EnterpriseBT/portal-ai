import {
  DataTableBlockContentSchema,
  DataTableHandleContentSchema,
  DataTableInlineContentSchema,
  DataTableStoredContentSchema,
} from "../../contracts/data-table-widget.contract.js";
import {
  D3BlockContentSchema,
  D3StoredContentSchema,
} from "../../contracts/d3-widget.contract.js";
import {
  GeoBlockContentSchema,
  GeoStoredContentSchema,
} from "../../contracts/map-spec.contract.js";
import { NotKeptContentSchema } from "../../contracts/stored-result.contract.js";
import { NotKeptContentSchema as BarrelNotKept } from "../../contracts/index.js";

// #1038: a stored result keeps the recipe that re-runs it, never its rows. A
// result with no recipe isn't kept, and says so.

const pipeline = {
  sql: "SELECT name FROM contacts",
  stationId: "st-1",
  organizationId: "org-1",
};

const notKept = {
  type: "data-table",
  notKept: true,
  columns: ["name"],
  rowCount: 3,
};

describe("stored result contracts (#1038)", () => {
  it("a stored table is its pipeline and metadata, with no rows", () => {
    const content = {
      type: "data-table",
      columns: ["name"],
      rowCount: 3,
      pipeline,
    };
    expect(DataTableStoredContentSchema.parse(content)).toEqual(content);
    expect(DataTableBlockContentSchema.parse(content)).toEqual(content);
  });

  it("a stored table needs its pipeline", () => {
    expect(
      DataTableStoredContentSchema.safeParse({ columns: ["name"] }).success
    ).toBe(false);
  });

  it("a stored chart is its program and pipeline, with no rows", () => {
    // Like the in-turn d3 shapes, the content carries no `type` key.
    const content = { program: "api.d3;", pipeline };
    expect(D3StoredContentSchema.parse(content)).toEqual(content);
    expect(D3BlockContentSchema.safeParse(content).success).toBe(true);
  });

  it("a stored map is its spec and pipeline, with no rows", () => {
    const content = {
      spec: {
        layers: [
          {
            kind: "points" as const,
            source: { latColumn: "latitude", lngColumn: "longitude" },
          },
        ],
      },
      pipeline,
    };
    const stored = GeoStoredContentSchema.parse(content);
    expect(stored.pipeline).toEqual(pipeline);
    expect(stored).not.toHaveProperty("rows");
    expect(GeoBlockContentSchema.safeParse(content).success).toBe(true);
  });

  it("a result with no recipe parses as not kept, from the shared schema", () => {
    expect(NotKeptContentSchema.parse(notKept)).toEqual(notKept);
    expect(BarrelNotKept).toBe(NotKeptContentSchema);
  });

  it("a not-kept result isn't a block branch: widgets check for it first", () => {
    expect(DataTableBlockContentSchema.safeParse(notKept).success).toBe(false);
    expect(D3BlockContentSchema.safeParse(notKept).success).toBe(false);
    expect(GeoBlockContentSchema.safeParse(notKept).success).toBe(false);
  });

  it("in-turn content still resolves to its handle or inline branch first", () => {
    const handle = {
      queryHandle: "qh-1",
      rowCount: 3,
      schema: [{ name: "name", type: "text" }],
      sampled: false,
      truncated: false,
      samplePeek: [],
      sql: null,
      pipeline,
    };
    const inline = { columns: ["name"], rows: [{ name: "Acme" }], pipeline };
    expect(DataTableBlockContentSchema.parse(handle)).toEqual(
      DataTableHandleContentSchema.parse(handle)
    );
    expect(DataTableBlockContentSchema.parse(inline)).toEqual(
      DataTableInlineContentSchema.parse(inline)
    );
  });
});
