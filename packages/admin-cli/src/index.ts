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

export { requireMutationOperator, decodeSub } from "./session.js";

export { orgList, orgGet, orgUpdate, orgSetTier, orgDelete } from "./commands/org.js";
export { userList, userGet } from "./commands/user.js";
export { memberAdd, memberRemove, memberSwitch } from "./commands/member.js";
export { authLogin, authLogout } from "./commands/auth.js";
export { withStore, beginMutation, type MutateFlags } from "./commands/common.js";

export { EXIT_CODES, exitCodeFor, printBanner, jsonError } from "./output.js";
