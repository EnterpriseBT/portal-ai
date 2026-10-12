import { jest, describe, it, expect } from "@jest/globals";

// The pure halves (normalize, mergePatch) need no database; patchRecord is
// covered by the entity-record router integration tests.
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: {} },
}));
jest.unstable_mockModule("../../services/entity-record-count.cache.js", () => ({
  EntityRecordCountCache: { invalidate: jest.fn() },
}));

const { RecordWriteService } =
  await import("../../services/record-write.service.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");

function mapping(
  normalizedKey: string,
  type: string,
  over: Record<string, unknown> = {}
) {
  return {
    normalizedKey,
    sourceField: normalizedKey,
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    columnDefinition: {
      type,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
    },
    ...over,
  } as never;
}

const MAPPINGS = [
  mapping("name", "string", { required: true }),
  mapping("status", "string", { required: true, defaultValue: "open" }),
  mapping("geom", "geometry"),
];

describe("RecordWriteService.normalize", () => {
  it("stores the normalizer's output: defaults applied, validity from it", () => {
    const [r] = RecordWriteService.normalize(MAPPINGS, [
      { sourceId: "s1", input: { name: "Ada", status: "" } },
    ]);
    expect(r.normalizedData).toEqual({
      name: "Ada",
      status: "open",
      geom: null,
    });
    expect(r.isValid).toBe(true);
  });

  it("a blank required field is invalid, not refused", () => {
    const [r] = RecordWriteService.normalize(MAPPINGS, [
      { sourceId: "s1", input: { name: "" } },
    ]);
    expect(r.isValid).toBe(false);
    expect(r.validationErrors).toEqual([
      expect.objectContaining({ field: "name" }),
    ]);
  });

  it.each([[""], ["nope"]])(
    "a geometry it can't parse (%j) is refused with #757's 400",
    (geom) => {
      expect(() =>
        RecordWriteService.normalize(MAPPINGS, [
          { sourceId: "s1", input: { name: "Ada", geom } },
        ])
      ).toThrow(
        expect.objectContaining({
          status: 400,
          code: ApiCode.GEOMETRY_INVALID_ON_IMPORT,
          message: expect.stringMatching(/^Field "geom"/),
        })
      );
    }
  );

  it("a null, absent or parseable geometry is not refused here", () => {
    const rows = [
      { sourceId: "a", input: { name: "A", geom: null } },
      { sourceId: "b", input: { name: "B" } },
      {
        sourceId: "c",
        input: { name: "C", geom: '{"type":"Point","coordinates":[1,2]}' },
      },
    ];
    const results = RecordWriteService.normalize(MAPPINGS, rows);
    expect(results[2].normalizedData.geom).toEqual({
      type: "Point",
      coordinates: [1, 2],
    });
  });

  it("a batch refusal names rows through `describe`", () => {
    expect(() =>
      RecordWriteService.normalize(
        MAPPINGS,
        [
          { sourceId: "a", input: { name: "A" } },
          { sourceId: "b", input: { name: "B", geom: "nope" } },
        ],
        { batch: true, describe: (id) => `row ${id}` }
      )
    ).toThrow(/nothing was written: row b\. Field "geom"/);
  });
});

describe("RecordWriteService.mergePatch", () => {
  const SYNCED = [mapping("name", "string", { sourceField: "Full Name" })];

  it("merges a patch over the stored data, keeping untouched keys", () => {
    expect(
      RecordWriteService.mergePatch(
        MAPPINGS,
        { name: "Before", note: "n" },
        { normalizedData: { name: "After" } }
      )
    ).toEqual({ name: "After", note: "n" });
  });

  it("writes a synced record's edit under its source field, so a later sync still wins", () => {
    expect(
      RecordWriteService.mergePatch(
        SYNCED,
        { "Full Name": "Before" },
        { normalizedData: { name: "After" } }
      )
    ).toEqual({ "Full Name": "After" });
  });

  it("keeps a record's own normalizedKey when it already holds one", () => {
    expect(
      RecordWriteService.mergePatch(
        SYNCED,
        { "Full Name": "a", name: "b" },
        { normalizedData: { name: "After" } }
      )
    ).toEqual({ "Full Name": "a", name: "After" });
  });

  it("applies a raw `data` patch as given", () => {
    expect(
      RecordWriteService.mergePatch(
        SYNCED,
        { "Full Name": "a", Email: "e" },
        { data: { "Full Name": "Z" } }
      )
    ).toEqual({ "Full Name": "Z", Email: "e" });
  });
});
