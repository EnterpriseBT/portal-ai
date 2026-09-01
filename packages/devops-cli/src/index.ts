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
  setVar,
  applyVars,
  templateVars,
  type DescribeResult,
  type DescribeEntry,
  type ListEntry,
  type SetResult,
  type MutateOptions,
} from "./commands/vars.js";

export {
  localProvision,
  E2E_FIXTURE_ORG_NAME,
  type LocalProvisionOptions,
  type LocalProvisionResult,
  type LocalProvisionDeps,
  type ProvisionStep,
  type ProvisionStepName,
} from "./commands/local.js";

export { EXIT_CODES, exitCodeFor, printBanner, jsonError } from "./output.js";
