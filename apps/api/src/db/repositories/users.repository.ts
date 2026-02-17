/**
 * Repository for the `users` table.
 *
 * Extends the generic {@link Repository} with user-specific queries
 * such as lookup by Auth0 subject ID and upsert-on-login.
 */

import { eq, and } from "drizzle-orm";
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
