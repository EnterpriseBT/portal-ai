/**
 * @portalai/admin-cli — portalai, Portal's customer-app-data operator CLI
 * (#190, epic #191). Library-first: every capability is an exported
 * function; dist/bin.js is thin commander wiring. Infra-free and Node-only;
 * the future public customer CLI extends this domain core.
 */

export {
  AdminCliError,
  AdminNotFoundError,
  AdminConflictError,
  type AdminCliErrorCode,
} from "./errors.js";

export {
  createAdminStore,
  createDbAdminStore,
  type AdminStore,
  type ListOrgsOptions,
  type ListUsersOptions,
} from "./store.js";

export { organizations, users, organizationUsers, tiers } from "./tables.js";

export { EXIT_CODES, exitCodeFor, printBanner, jsonError } from "./output.js";
