/**
 * The reap mark's best-effort variant, and which callers must use it
 * (#441 slice 3, folding in #456; reworked for #450).
 *
 * A sync that wrote all 397,960 of its records reported `failed` because the
 * `er__<id>` half of the reap could not run. Every other wide-table write on
 * that path is already best-effort by design, and the reap was the one
 * operation that could still take a completed sync's status with it.
 *
 * #450 changed the reap from a physical DELETE of the reaped ids to a
 * **self-healing** `markDeletedFromRecords` (a server-side join UPDATE that
 * marks every unmarked orphan, not a specific id set), wrapped best-effort.
 * The bounded request paths keep a strict, id-list `markDeletedByEntityRecordIds`
 * inside the record-soft-delete transaction.
 *
 * Two things are asserted, and the second is the one that rots:
 *  1. The best-effort wrapper swallows and reports; the strict method throws.
 *  2. **Each call site uses the right one** — the four batch/reap paths degrade,
 *     the request path fails loudly — pinned against the source.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const mockMark = jest.fn<(...a: unknown[]) => Promise<number>>();

jest.unstable_mockModule("../../../db/client.js", () => ({ db: {} }));

const { WideTableRepository } =
  await import("../../../db/repositories/wide-table.repository.js");

const srcRoot = fileURLToPath(new URL("../../../", import.meta.url));

const read = (rel: string) => readFile(`${srcRoot}${rel}`, "utf8");

describe("reap mark — best-effort wrapper (#441 / #456 / #450)", () => {
  let repo: InstanceType<typeof WideTableRepository>;

  beforeEach(() => {
    repo = new WideTableRepository();
    mockMark.mockReset();
    // Replace the self-healing primitive so the wrapper's behaviour is isolated
    // from SQL generation.
    (
      repo as unknown as { markDeletedFromRecords: unknown }
    ).markDeletedFromRecords = mockMark;
  });

  it("reports degraded:false and the marked count when the mark succeeds", async () => {
    mockMark.mockResolvedValue(7);

    const out = await repo.markDeletedFromRecordsBestEffort("ent-1");

    expect(out).toEqual({ degraded: false, marked: 7 });
    expect(mockMark).toHaveBeenCalledTimes(1);
  });

  it("swallows a throwing mark and reports degraded:true", async () => {
    mockMark.mockRejectedValue(
      new Error('relation "er__ent-1" does not exist')
    );

    const out = await repo.markDeletedFromRecordsBestEffort("ent-1");

    // The whole point: the caller's sync survives.
    expect(out.degraded).toBe(true);
  });

  it("the strict id-list mark still throws — the request paths depend on it", async () => {
    const strictRepo = new WideTableRepository();
    const boom = new Error("nope");
    (
      strictRepo as unknown as { markDeletedByEntityRecordIds: unknown }
    ).markDeletedByEntityRecordIds = jest.fn(async () => {
      throw boom;
    });

    await expect(
      (
        strictRepo as unknown as {
          markDeletedByEntityRecordIds: (
            a: string,
            b: string[],
            c: number
          ) => Promise<void>;
        }
      ).markDeletedByEntityRecordIds("ent-1", ["a"], 1)
    ).rejects.toThrow(boom);
  });
});

describe("reap mark — call sites use the right variant (#441 / #456 / #450)", () => {
  /** The four batch/reap paths: a failure here must not fail the run. */
  const BEST_EFFORT_SITES = [
    "adapters/rest-api/rest-api.adapter.ts",
    "adapters/google-sheets/google-sheets.adapter.ts",
    "adapters/microsoft-excel/microsoft-excel.adapter.ts",
    "services/layout-plan-draft.service.ts",
  ];

  /** The request path: a failure here SHOULD reach the caller. */
  const STRICT_SITES = ["routes/entity-record.router.ts"];

  it.each(BEST_EFFORT_SITES)(
    "%s uses the self-healing best-effort mark",
    async (rel) => {
      expect(await read(rel)).toContain("markDeletedFromRecordsBestEffort");
    }
  );

  it.each(STRICT_SITES)("%s uses the strict id-list mark", async (rel) => {
    const src = await read(rel);
    expect(src).toContain("markDeletedByEntityRecordIds(");
    expect(src).not.toContain("markDeletedFromRecordsBestEffort");
  });

  it("no caller still references the removed delete methods", async () => {
    // The old `deleteByEntityRecordIds*` issued a hard DELETE; #450 replaced it
    // with a soft-delete mark. `softDeleteByEntityRecordIds` was an even older
    // misnomer. None should survive.
    for (const rel of [...BEST_EFFORT_SITES, ...STRICT_SITES]) {
      const src = await read(rel);
      expect(src).not.toContain("deleteByEntityRecordIds");
      expect(src).not.toContain("softDeleteByEntityRecordIds");
    }
  });
});
