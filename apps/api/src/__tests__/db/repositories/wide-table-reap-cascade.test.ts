/**
 * The reap cascade's best-effort variant, and which callers must use it
 * (#441 slice 3, folding in #456).
 *
 * A sync that wrote all 397,960 of its records reported `failed` because the
 * `er__<id>` half of the reap cascade could not run. Every other wide-table
 * write on that path is already best-effort by design — `mirrorBatchToWideTable`
 * and the missing-row probe both log and continue — and the reap cascade was
 * the one operation that could still take a completed sync's status with it.
 *
 * Two things are asserted here, and the second is the one that rots:
 *
 *  1. The best-effort wrapper swallows and reports, and the strict method
 *     still throws. Both behaviours are load-bearing.
 *  2. **Each call site uses the right one.** There are six, and only the four
 *     batch paths should degrade. The two request paths in
 *     `entity-record.router.ts` must keep failing loudly: a request can report
 *     failure honestly to a caller who can retry, where a sync that has
 *     already committed 397,960 rows cannot un-write them. Nothing else stops
 *     a future edit from quietly flipping one of the six, so the split is
 *     pinned against the source — the same shape as the cost-gate guard test
 *     that asserts every tool is wrapped.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const mockStrict = jest.fn<(...a: unknown[]) => Promise<void>>();

jest.unstable_mockModule("../../../db/client.js", () => ({ db: {} }));

const { WideTableRepository } =
  await import("../../../db/repositories/wide-table.repository.js");

const srcRoot = fileURLToPath(new URL("../../../", import.meta.url));

const read = (rel: string) => readFile(`${srcRoot}${rel}`, "utf8");

describe("reap cascade — best-effort wrapper (#441 / #456)", () => {
  let repo: InstanceType<typeof WideTableRepository>;

  beforeEach(() => {
    repo = new WideTableRepository();
    mockStrict.mockReset();
    // Replace the strict primitive so the wrapper's behaviour is isolated
    // from SQL generation, which `wide-table-id-chunking.test.ts` covers.
    (
      repo as unknown as { deleteByEntityRecordIds: unknown }
    ).deleteByEntityRecordIds = mockStrict;
  });

  it("reports degraded:false when the cascade succeeds", async () => {
    mockStrict.mockResolvedValue(undefined);

    const out = await repo.deleteByEntityRecordIdsBestEffort("ent-1", [
      "a",
      "b",
    ]);

    expect(out.degraded).toBe(false);
    expect(mockStrict).toHaveBeenCalledTimes(1);
  });

  it("swallows a throwing cascade and reports degraded:true", async () => {
    mockStrict.mockRejectedValue(
      new Error('relation "er__ent-1" does not exist')
    );

    const out = await repo.deleteByEntityRecordIdsBestEffort("ent-1", ["a"]);

    // The whole point: the caller's sync survives.
    expect(out.degraded).toBe(true);
  });

  it("reports degraded:false for an empty id list without touching the DB", async () => {
    const out = await repo.deleteByEntityRecordIdsBestEffort("ent-1", []);

    expect(out.degraded).toBe(false);
    expect(mockStrict).not.toHaveBeenCalled();
  });

  it("the strict method still throws — the request paths depend on it", async () => {
    const strictRepo = new WideTableRepository();
    const boom = new Error("nope");
    (
      strictRepo as unknown as { deleteByEntityRecordIds: unknown }
    ).deleteByEntityRecordIds = jest.fn(async () => {
      throw boom;
    });

    await expect(
      (
        strictRepo as unknown as {
          deleteByEntityRecordIds: (a: string, b: string[]) => Promise<void>;
        }
      ).deleteByEntityRecordIds("ent-1", ["a"])
    ).rejects.toThrow(boom);
  });
});

describe("reap cascade — call sites use the right variant (#441 / #456)", () => {
  /** The four batch paths: a failure here must not fail the run. */
  const BEST_EFFORT_SITES = [
    "adapters/rest-api/rest-api.adapter.ts",
    "adapters/google-sheets/google-sheets.adapter.ts",
    "adapters/microsoft-excel/microsoft-excel.adapter.ts",
    "services/layout-plan-draft.service.ts",
  ];

  /** The two request paths: a failure here SHOULD reach the caller. */
  const STRICT_SITES = ["routes/entity-record.router.ts"];

  it.each(BEST_EFFORT_SITES)("%s uses the best-effort variant", async (rel) => {
    const src = await read(rel);
    expect(src).toContain("deleteByEntityRecordIdsBestEffort");
  });

  it.each(STRICT_SITES)("%s keeps the strict variant", async (rel) => {
    const src = await read(rel);
    expect(src).toContain("deleteByEntityRecordIds(");
    expect(src).not.toContain("deleteByEntityRecordIdsBestEffort");
  });

  it("no caller still references the old misleading name", async () => {
    // `softDeleteByEntityRecordIds` issued a hard DELETE. The name cost real
    // time during this epic's investigation — it is why the wide table was
    // first believed to hold tombstones it never had.
    for (const rel of [...BEST_EFFORT_SITES, ...STRICT_SITES]) {
      expect(await read(rel)).not.toContain("softDeleteByEntityRecordIds");
    }
  });
});
