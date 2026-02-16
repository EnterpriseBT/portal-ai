import { pgTable, text } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";

/**
 * User profiles table.
 *
 * The `id` column stores the Auth0 `sub` claim, making it the link
 * between the identity provider and the local database.
 */
export const userProfiles = pgTable("user_profiles", {
  ...baseColumns,
  email: text("email"),
  name: text("name"),
  picture: text("picture"),
});
