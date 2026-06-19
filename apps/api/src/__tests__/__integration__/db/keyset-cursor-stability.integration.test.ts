import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";

/**
 * #129 slice-2 SPIKE — the gate for mechanism A (re-execute + keyset).
 *
 * The whole streamable-cursor design rests on one assumption: a query can be
 * **re-executed** and paged by keyset with **no skipped or duplicated rows**,
 * in a deterministic order, even while the source is being written. This
 * isolates that primitive against a temp table — no `er__` / PortalSqlService
 * stack — so a pass/fail here is a clean verdict on the mechanism.
 *
 * The key is a **composite `(order_col, id)`** — the shape a streaming reduce
 * needs: it streams in the query's semantic order (`order_col`, e.g. a
 * timestamp, which may have ties) with a unique tiebreaker (`id`). Keying on
 * the unique id alone would page stably but in the WRONG order; keying on
 * `order_col` alone would skip/dup within ties. The composite is the design
 * `resolveSortKey` must produce.
 *
 * If this fails, STOP — mechanism A needs rework before `streamHandle` is
 * built on it.
 */

type Row = { order_col: number; id: number; data: string };

describe("#129 keyset cursor stability (spike)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  const table = `keyset_spike_${Date.now()}`;
  const tbl = sql.identifier(table);

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection);
    await db.execute(
      sql.raw(
        `CREATE UNLOGGED TABLE "${table}" (` +
          `order_col int NOT NULL, id int NOT NULL, data text, ` +
          `PRIMARY KEY (order_col, id))`
      )
    );
  });

  afterAll(async () => {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${table}" CASCADE`));
    await connection.end();
  });

  async function insert(rows: Row[]): Promise<void> {
    for (const r of rows) {
      await db.execute(
        sql`INSERT INTO ${tbl} (order_col, id, data) VALUES (${r.order_col}, ${r.id}, ${r.data})`
      );
    }
  }

  /** One keyset page, re-executing the query each call (mechanism A). */
  async function page(
    after: { o: number; i: number } | null,
    limit: number
  ): Promise<Row[]> {
    const where = after
      ? sql`WHERE (order_col, id) > (${after.o}, ${after.i})`
      : sql``;
    const res = await db.execute(
      sql`SELECT order_col, id, data FROM ${tbl} ${where} ORDER BY order_col, id ASC LIMIT ${limit}`
    );
    return res as unknown as Row[];
  }

  /** Walk the whole table by keyset, re-executing every page. */
  async function drain(limit: number): Promise<Row[]> {
    const out: Row[] = [];
    let after: { o: number; i: number } | null = null;
    for (;;) {
      const p = await page(after, limit);
      if (p.length === 0) break;
      out.push(...p);
      const last = p[p.length - 1];
      after = { o: last.order_col, i: last.id };
      if (p.length < limit) break;
    }
    return out;
  }

  // 12 rows, order_col in groups of 3 (ties → exercises the tiebreaker):
  // ids 0-2 → o0, 3-5 → o1, 6-8 → o2, 9-11 → o3.
  const base: Row[] = Array.from({ length: 12 }, (_, i) => ({
    order_col: Math.floor(i / 3),
    id: i,
    data: `r${i}`,
  }));

  it("pages a tie-heavy table once, in (order_col, id) order, no skip/dup", async () => {
    await insert(base);
    const drained = await drain(4);

    expect(drained.map((r) => r.id)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(new Set(drained.map((r) => r.id)).size).toBe(12); // no dup
    // strictly ascending by (order_col, id)
    for (let k = 1; k < drained.length; k++) {
      const a = drained[k - 1];
      const b = drained[k];
      expect(a.order_col < b.order_col || a.id < b.id).toBe(true);
    }
  });

  it("under a concurrent insert mid-walk: after-cursor row appears, before-cursor row doesn't, never duplicates", async () => {
    // (base 12 rows already inserted by the prior test.)
    const limit = 4;
    const out: Row[] = [];
    let after: { o: number; i: number } | null = null;

    // Page 1 + 2 (8 rows) → cursor lands at (2, 7).
    for (let pageNo = 0; pageNo < 2; pageNo++) {
      const p = await page(after, limit);
      out.push(...p);
      const last = p[p.length - 1];
      after = { o: last.order_col, i: last.id };
    }
    expect(after).toEqual({ o: 2, i: 7 });

    // Concurrent writes mid-walk:
    //  - (5, 50) sorts AFTER the cursor → must appear in a later page.
    //  - (0, 99) sorts BEFORE the cursor → already passed → must NOT appear.
    await insert([
      { order_col: 5, id: 50, data: "after" },
      { order_col: 0, id: 99, data: "before" },
    ]);

    // Finish the walk from the cursor.
    for (;;) {
      const p = await page(after, limit);
      if (p.length === 0) break;
      out.push(...p);
      const last = p[p.length - 1];
      after = { o: last.order_col, i: last.id };
      if (p.length < limit) break;
    }

    const ids = out.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // never duplicates
    expect(ids).toContain(50); // after-cursor insert is seen
    expect(ids).not.toContain(99); // before-cursor insert is not
    // every original row exactly once
    for (let i = 0; i < 12; i++) expect(ids.filter((x) => x === i)).toHaveLength(1);
  });
});
