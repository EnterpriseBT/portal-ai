/**
 * @portalai/cli-env — the shared environment-access layer for the Portal CLIs
 * (#194, epic #191). Consumed by @portalai/admin-cli (#190) and
 * @portalai/devops-cli (#192). Node-only; never imported by apps/web or
 * packages/core.
 */

export {
  CliEnvError,
  EnvNotConfiguredError,
  EnvNotAuthorizedError,
  EnvDestructiveBlockedError,
  EnvConfirmationRequiredError,
  EnvInfraError,
  type CliEnvErrorCode,
} from "./errors.js";

export {
  BUILTIN_ENVIRONMENTS,
  EnvironmentDefinitionSchema,
  EnvKindSchema,
  loadEnvironments,
  getEnvironment,
  portalaiDir,
  secretsPrefix,
  ssmPrefix,
  clusterName,
  bastionExportName,
  type EnvironmentDefinition,
  type EnvKind,
} from "./registry.js";

export {
  assertOperationAllowed,
  envBanner,
  type OperationGuardOptions,
} from "./guard.js";
