/**
 * @portalai/devops-cli — portalops, Portal's infrastructure operator CLI
 * (#192, epic #191). Library-first: every command is an exported function;
 * dist/bin.js is thin commander wiring. Node-only.
 */

export {
  CATALOG,
  lookupKey,
  pathFor,
  mask,
  type CatalogEntry,
  type CatalogKind,
} from "./catalog.js";

export {
  describeVars,
  listVars,
  getVar,
  type DescribeResult,
  type DescribeEntry,
  type ListEntry,
} from "./commands/vars.js";

export { EXIT_CODES, exitCodeFor, printBanner, jsonError } from "./output.js";
