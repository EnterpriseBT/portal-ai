import { bigint, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";

/**
 * User profiles table.
 *
 * The `auth0_id` column stores the Auth0 `sub` claim, linking the
 * identity provider profile to the local database row.
 *
 * `auth0_id` is uniquely indexed among live rows (#583) — the hard idempotency
 * backstop for first-login provisioning + the `onConflictDoNothing` target of
 * `UsersRepository.findOrCreateByAuth0Id`. Partial on the soft-delete guard so a
 * tombstoned row never blocks a re-registration.
 */
export const users = pgTable(
  "users",
  {
    ...baseColumns,
    auth0Id: text("auth0_id").notNull(),
    email: text("email"),
    name: text("name"),
    picture: text("picture"),
    lastLogin: bigint("last_login", { mode: "number" }),
    // #577: the last-seen login-session marker (auth_time → sid → iat) used to
    // dedup per-login side-effects (auth.login audit + profile refresh) on the
    // request path. Null until the first login is observed post-deploy.
    lastLoginSession: text("last_login_session"),
  },
  (t) => [
    uniqueIndex("users_auth0_id_unique")
      .on(t.auth0Id)
      .where(sql`${t.deleted} IS NULL`),
  ]
);
