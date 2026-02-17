import { pgTable, text } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";

/**
 * User profiles table.
 *
 * The `auth0_id` column stores the Auth0 `sub` claim, linking the
 * identity provider profile to the local database row.
 */
export const users = pgTable("users", {
  ...baseColumns,
  auth0Id: text("auth0_id").notNull(),
  email: text("email"),
  name: text("name"),
  picture: text("picture"),
});
