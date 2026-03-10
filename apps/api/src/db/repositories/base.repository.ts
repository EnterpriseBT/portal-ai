/**
 * Generic base repository for type-safe CRUD operations on any Drizzle table.
 *
 * Every table in this project shares `baseColumns` (id, created, createdBy,
 * updated, updatedBy, deleted, deletedBy), so the repository is built around
 * soft-delete semantics by default.
 *
 * All methods accept an optional `DbClient` parameter so they can be
 * composed inside SQL transactions.
 *
 * @example
 *   // Simple read
 *   const user = await usersRepo.findById("abc-123");
 *
 *   // Cross-service transaction
 *   await Repository.transaction(async (tx) => {
 *     const org  = await orgsRepo.create({ ... }, tx);
 *     await orgUsersRepo.create({ organizationId: org.id, ... }, tx);
 *   });
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  type InferSelectModel,
  type InferInsertModel,
  type SQL,
  sql,
  getTableColumns,
  eq,
  and,
  isNull,
  inArray,
  count,
  type Column,
} from "drizzle-orm";
import type { PgTable, IndexColumn } from "drizzle-orm/pg-core";
import { db } from "../client.js";

// ── Types ──────────────────────────────────────────────────────────

/**
 * The Drizzle transaction type, extracted from `db.transaction`'s callback.
 * This ensures the type always matches the actual driver in use.
 */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Union of the root database instance and a transaction.
 * Every repository method accepts this so callers choose the execution context.
 */
export type DbClient = typeof db | DbTransaction;

/** A manually controlled transaction with explicit commit / rollback. */
export interface TransactionClient {
  /** The Drizzle transaction object – pass this to repository methods. */
  tx: DbTransaction;
  /** Commit the transaction. */
  commit: () => Promise<void>;
  /** Roll back the transaction. */
  rollback: () => Promise<void>;
}

/** Options for list / findMany queries. */
export interface ListOptions {
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

/** Payload shape for bulk-updating records with per-row data. */
export interface BulkUpdatePayload<TInsert> {
  id: string;
  data: Partial<TInsert>;
}

// ── Base repository ────────────────────────────────────────────────

export class Repository<
  TTable extends PgTable,
  TSelect = InferSelectModel<TTable>,
  TInsert = InferInsertModel<TTable>,
> {
  /** Cached column references extracted from the table definition. */
  protected readonly cols: Record<string, Column>;

  constructor(protected readonly table: TTable) {
    this.cols = getTableColumns(table) as Record<string, Column>;
  }

  // ── Internal helpers ───────────────────────────────────────────

  /** Returns a `WHERE deleted IS NULL` filter. */
  protected notDeleted(): SQL {
    return isNull(this.cols.deleted);
  }

  /**
   * Merge caller-supplied conditions with the soft-delete guard.
   * When `includeDeleted` is true the guard is skipped.
   */
  protected withSoftDelete(
    where: SQL | undefined,
    includeDeleted = false
  ): SQL | undefined {
    if (includeDeleted) return where;
    return where ? and(where, this.notDeleted()) : this.notDeleted();
  }

  // ── READ ───────────────────────────────────────────────────────

  /** Fetch a single row by primary key (soft-delete aware). */
  async findById(
    id: string,
    client: DbClient = db
  ): Promise<TSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table as any)
      .where(and(eq(this.cols.id, id), this.notDeleted()))
      .limit(1);
    return row as TSelect | undefined;
  }

  /**
   * Return rows matching an optional `where` clause.
   * Supports pagination and an opt-in to include soft-deleted records.
   */
  async findMany(
    where?: SQL,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<TSelect[]> {
    const conditions = this.withSoftDelete(where, opts.includeDeleted);

    let query = (client as typeof db)
      .select()
      .from(this.table as any)
      .where(conditions)
      .$dynamic();
    if (opts.limit !== undefined) query = query.limit(opts.limit);
    if (opts.offset !== undefined) query = query.offset(opts.offset);
    return (await query) as TSelect[];
  }

  /** Count rows matching an optional `where` clause (soft-delete aware). */
  async count(where?: SQL, client: DbClient = db): Promise<number> {
    const conditions = this.withSoftDelete(where);

    const [result] = await (client as typeof db)
      .select({ count: count() })
      .from(this.table as any)
      .where(conditions);
    return Number(result.count);
  }

  // ── CREATE ─────────────────────────────────────────────────────

  /** Insert a single row and return it. */
  async create(data: TInsert, client: DbClient = db): Promise<TSelect> {
    const [row] = await (client as typeof db)
      .insert(this.table)
      .values(data as any)
      .returning();
    return row as TSelect;
  }

  /** Insert multiple rows in a single statement and return them all. */
  async createMany(data: TInsert[], client: DbClient = db): Promise<TSelect[]> {
    if (data.length === 0) return [];

    const rows = await (client as typeof db)
      .insert(this.table)
      .values(data as any)
      .returning();
    return rows as TSelect[];
  }

  // ── UPSERT ─────────────────────────────────────────────────────

  /**
   * Build a `set` object that references `excluded` columns for upserts.
   * This ensures each conflicting row is updated with its own proposed values.
   */
  private buildExcludedSet(): Record<string, SQL> {
    const set: Record<string, SQL> = {};
    for (const [name, col] of Object.entries(this.cols)) {
      if (name === "id") continue;
      set[name] = sql.raw(`excluded."${col.name}"`);
    }
    return set;
  }

  /**
   * Insert a row or update it if a row with the same `id` already exists.
   * Returns the resulting row.
   */
  async upsert(data: TInsert, client: DbClient = db): Promise<TSelect> {
    const [row] = await (client as typeof db)
      .insert(this.table)
      .values(data as any)
      .onConflictDoUpdate({
        target: this.cols.id as IndexColumn,
        set: this.buildExcludedSet() as any,
      })
      .returning();
    return row as TSelect;
  }

  /**
   * Insert multiple rows, updating any that conflict on `id`.
   * Executes as a single statement. Returns all resulting rows.
   */
  async upsertMany(data: TInsert[], client: DbClient = db): Promise<TSelect[]> {
    if (data.length === 0) return [];

    const rows = await (client as typeof db)
      .insert(this.table)
      .values(data as any)
      .onConflictDoUpdate({
        target: this.cols.id as IndexColumn,
        set: this.buildExcludedSet() as any,
      })
      .returning();
    return rows as TSelect[];
  }

  // ── UPDATE ─────────────────────────────────────────────────────

  /** Update a single row by ID and return the updated row. */
  async update(
    id: string,
    data: Partial<TInsert>,
    client: DbClient = db
  ): Promise<TSelect | undefined> {
    const [row] = await (client as typeof db)
      .update(this.table)
      .set(data as any)
      .where(and(eq(this.cols.id, id), this.notDeleted()))
      .returning();
    return row as TSelect | undefined;
  }

  /**
   * Apply the same partial update to all rows matching a `where` clause.
   * Returns all updated rows.
   */
  async updateWhere(
    where: SQL,
    data: Partial<TInsert>,
    client: DbClient = db
  ): Promise<TSelect[]> {
    const conditions = this.withSoftDelete(where);
    const rows = await (client as typeof db)
      .update(this.table)
      .set(data as any)
      .where(conditions)
      .returning();
    return rows as TSelect[];
  }

  /**
   * Update multiple rows with per-row data.
   * Runs inside a transaction for atomicity. If a transaction is already
   * provided via `client`, it re-uses that transaction.
   */
  async updateMany(
    payloads: BulkUpdatePayload<TInsert>[],
    client: DbClient = db
  ): Promise<TSelect[]> {
    if (payloads.length === 0) return [];

    const exec = async (tx: DbClient): Promise<TSelect[]> => {
      const results: TSelect[] = [];
      for (const { id, data } of payloads) {
        const row = await this.update(id, data, tx);
        if (row) results.push(row);
      }
      return results;
    };

    // Re-use an existing transaction, otherwise create one.
    if (client !== db) return exec(client);
    return db.transaction((tx) => exec(tx));
  }

  // ── SOFT DELETE ────────────────────────────────────────────────

  /** Soft-delete a single row by ID. */
  async softDelete(
    id: string,
    deletedBy: string,
    client: DbClient = db
  ): Promise<TSelect | undefined> {
    const now = Date.now();
    const [row] = await (client as typeof db)
      .update(this.table)
      .set({ deleted: now, deletedBy } as any)
      .where(and(eq(this.cols.id, id), this.notDeleted()))
      .returning();
    return row as TSelect | undefined;
  }

  /** Soft-delete multiple rows by ID. Returns the number of affected rows. */
  async softDeleteMany(
    ids: string[],
    deletedBy: string,
    client: DbClient = db
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const now = Date.now();
    const result = await (client as typeof db)
      .update(this.table)
      .set({ deleted: now, deletedBy } as any)
      .where(and(inArray(this.cols.id, ids), this.notDeleted()))
      .returning();
    return result.length;
  }

  // ── HARD DELETE (use sparingly) ────────────────────────────────

  /** Permanently remove a row from the database. */
  async hardDelete(id: string, client: DbClient = db): Promise<boolean> {
    const result = await (client as typeof db)
      .delete(this.table)
      .where(eq(this.cols.id, id))
      .returning();
    return result.length > 0;
  }

  /** Permanently remove multiple rows by ID. Returns the count deleted. */
  async hardDeleteMany(ids: string[], client: DbClient = db): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await (client as typeof db)
      .delete(this.table)
      .where(inArray(this.cols.id, ids))
      .returning();
    return result.length;
  }

  // ── TRANSACTIONS ───────────────────────────────────────────────

  /**
   * Convenience wrapper around `db.transaction`.
   * Allows any caller to open a transaction without importing `db` directly.
   *
   * @example
   *   const result = await Repository.transaction(async (tx) => {
   *     const a = await repoA.create(dataA, tx);
   *     const b = await repoB.create(dataB, tx);
   *     return { a, b };
   *   });
   */
  static async transaction<R>(
    fn: (tx: DbTransaction) => Promise<R>
  ): Promise<R> {
    return db.transaction(fn);
  }

  /**
   * Create a transaction client that can be committed or rolled back manually.
   *
   * Unlike `Repository.transaction`, which uses a callback, this returns an
   * object whose `tx` can be passed to any repository method and later
   * committed or rolled back at the caller's discretion.
   *
   * **Important:** Always call either `commit()` or `rollback()` – failing to
   * do so will leave the underlying connection hanging.
   *
   * @example
   *   const { tx, commit, rollback } = await Repository.createTransactionClient();
   *   try {
   *     await repoA.create(dataA, tx);
   *     await repoB.create(dataB, tx);
   *     await commit();
   *   } catch (err) {
   *     await rollback();
   *     throw err;
   *   }
   */
  static async createTransactionClient(): Promise<TransactionClient> {
    let resolveTx!: (tx: DbTransaction) => void;
    let commitFn!: () => void;
    let rollbackFn!: (err: Error) => void;

    const txReady = new Promise<DbTransaction>((resolve) => {
      resolveTx = resolve;
    });

    const txComplete = new Promise<void>((resolve, reject) => {
      commitFn = resolve;
      rollbackFn = reject;
    });

    const txPromise = db.transaction(async (tx) => {
      resolveTx(tx);
      await txComplete;
    });

    const tx = await txReady;

    return {
      tx,
      commit: async () => {
        commitFn();
        await txPromise;
      },
      rollback: async () => {
        rollbackFn(new Error("Transaction rolled back"));
        try {
          await txPromise;
        } catch {
          // Expected – Drizzle rolls back when the callback rejects.
        }
      },
    };
  }
}
