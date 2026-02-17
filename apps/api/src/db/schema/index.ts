export { baseColumns } from "./base.columns.js";
export { userProfiles } from "./user-profiles.table.js";

/** Drizzle-zod derived schemas for runtime validation */
export {
  UserProfileSelectSchema,
  UserProfileInsertSchema,
  type UserProfileSelect,
  type UserProfileInsert,
} from "./zod.js";

/**
 * Type-checks — importing this module is a no-op at runtime but
 * causes a compile error if Drizzle schemas drift from @mcp-ui/core.
 */
import "./type-checks.js";
