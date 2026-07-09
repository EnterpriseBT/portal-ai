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

export { getSecret, getParam, getDatabaseUrl } from "./aws.js";

export {
  openDbTunnel,
  TUNNEL_READY_MARKER,
  type Tunnel,
  type OpenDbTunnelOptions,
} from "./tunnel.js";

export { login, logout, getToken, type LoginIo } from "./auth0.js";
