/**
 * Repository for the `users` table.
 *
 * Extends the generic {@link Repository} with user-specific queries
 * such as lookup by Auth0 subject ID and upsert-on-login.
 */

import { eq, and, isNull } from "drizzle-orm";
import { users } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { UserSelect, UserInsert } from "../schema/zod.js";

export class UsersRepository extends Repository<
  typeof users,
  UserSelect,
  UserInsert
> {
  constructor() {
    super(users);
  }

  /** Find a user by their Auth0 `sub` claim. */
  async findByAuth0Id(
    auth0Id: string,
    client: DbClient = db
  ): Promise<UserSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(and(eq(users.auth0Id, auth0Id), this.notDeleted()))
      .limit(1);
    return row;
  }

  /**
   * Find the live user for an Auth0 `sub`, creating it if absent (#583).
   *
   * Insert-on-conflict against the partial unique index `users_auth0_id_unique`
   * (`auth0_id WHERE deleted IS NULL`): the winner of a concurrent first-login
   * gets `created: true`; every loser — and every re-login — gets the existing
   * row with `created: false`, never a duplicate. The `where` restates the
   * index predicate so Postgres can infer the *partial* index as the conflict
   * target.
   */
  async findOrCreateByAuth0Id(
    data: UserInsert,
    client: DbClient = db
  ): Promise<{ user: UserSelect; created: boolean }> {
    const [inserted] = await (client as typeof db)
      .insert(this.table)
      // Drizzle's generic insert type isn't assignable from TInsert here — same
      // cast the base repository makes for every `.values(...)` (see its
      // file-level disable + rationale).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values(data as any)
      .onConflictDoNothing({
        target: users.auth0Id,
        where: isNull(users.deleted),
      })
      .returning();

    if (inserted) return { user: inserted as UserSelect, created: true };

    const existing = await this.findByAuth0Id(data.auth0Id, client);
    if (!existing) {
      // Extremely narrow race: the row we conflicted with was soft-deleted
      // between the insert's conflict and this read. Throw so the caller can
      // retry rather than hand back a phantom.
      throw new Error(
        `findOrCreateByAuth0Id: conflicted on ${data.auth0Id} but found no live row`
      );
    }
    return { user: existing, created: false };
  }

  /** Find a user by email address. */
  async findByEmail(
    email: string,
    client: DbClient = db
  ): Promise<UserSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(and(eq(users.email, email), this.notDeleted()))
      .limit(1);
    return row;
  }
}

/** Singleton instance — import this in route handlers / services. */
export const usersRepo = new UsersRepository();
