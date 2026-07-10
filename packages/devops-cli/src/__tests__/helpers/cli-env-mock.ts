/**
 * Hand-built mock of @portalai/cli-env for devops-cli unit tests.
 *
 * jest.importActual doesn't exist in Jest 29 ESM, and importing the real
 * package before unstable_mockModule poisons the module registry — so the
 * small surface devops-cli consumes is mirrored here (error classes with the
 * same `code`s, the trivial prefix helpers, a BUILTIN_ENVIRONMENTS fixture),
 * with jest.fn() seams for everything I/O-shaped. cli-env's real behavior is
 * covered by its own 53-case suite; these tests assert devops-cli's calls.
 */

import { jest } from "@jest/globals";

export class CliEnvError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = new.target.name;
  }
}
export class EnvNotConfiguredError extends CliEnvError {
  constructor(message: string) {
    super("ENV_NOT_CONFIGURED", message);
  }
}
export class EnvNotAuthorizedError extends CliEnvError {
  constructor(message: string) {
    super("ENV_NOT_AUTHORIZED", message);
  }
}
export class EnvDestructiveBlockedError extends CliEnvError {
  constructor(message: string) {
    super("ENV_DESTRUCTIVE_BLOCKED", message);
  }
}
export class EnvConfirmationRequiredError extends CliEnvError {
  constructor(message: string) {
    super("ENV_CONFIRMATION_REQUIRED", message);
  }
}
export class EnvInfraError extends CliEnvError {
  constructor(message: string) {
    super("ENV_INFRA_ERROR", message);
  }
}

export interface MockEnvDef {
  name: string;
  kind: "development" | "staging" | "production";
  apiBaseUrl: string;
  aws: { region: string; envName: string } | null;
}

export const BUILTIN_ENVIRONMENTS: Record<string, MockEnvDef> = {
  local: {
    name: "local",
    kind: "development",
    apiBaseUrl: "http://localhost:3001",
    aws: null,
  },
  "app-dev": {
    name: "app-dev",
    kind: "staging",
    apiBaseUrl: "https://api-dev.portalsai.io",
    aws: { region: "us-east-1", envName: "dev" },
  },
};

const requireAws = (def: MockEnvDef) => {
  if (!def.aws) throw new EnvNotConfiguredError(`"${def.name}" has no AWS config`);
  return def.aws;
};

/** I/O seams — reset these in beforeEach. */
export const mocks = {
  getSecret: jest.fn<(def: MockEnvDef, name: string) => Promise<string>>(),
  getParam: jest.fn<(def: MockEnvDef, name: string) => Promise<string>>(),
  putSecret:
    jest.fn<(def: MockEnvDef, name: string, v: string) => Promise<{ created: boolean }>>(),
  putParam:
    jest.fn<(def: MockEnvDef, name: string, v: string, t?: string) => Promise<void>>(),
  getDatabaseUrl: jest.fn<(def: MockEnvDef) => Promise<string>>(),
  openDbTunnel:
    jest.fn<(def: MockEnvDef, opts: unknown) => Promise<{ localPort: number; close: () => Promise<void> }>>(),
  resolveEnvConnection: jest.fn<(name: string) => Promise<unknown>>(),
  assertOperationAllowed: jest.fn<(def: MockEnvDef, opts: unknown) => void>(),
  recordAudit: jest.fn<(entry: unknown) => Promise<void>>(),
  getToken: jest.fn<(env: string) => Promise<string>>(),
};

export function resetCliEnvMocks(): void {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.recordAudit.mockResolvedValue(undefined);
}

/** The module factory for jest.unstable_mockModule("@portalai/cli-env", …). */
export function cliEnvMockModule(): Record<string, unknown> {
  return {
    // errors
    CliEnvError,
    EnvNotConfiguredError,
    EnvNotAuthorizedError,
    EnvDestructiveBlockedError,
    EnvConfirmationRequiredError,
    EnvInfraError,
    // registry surface
    BUILTIN_ENVIRONMENTS,
    getEnvironment: (name: string) => {
      const def = BUILTIN_ENVIRONMENTS[name];
      if (!def) throw new EnvNotConfiguredError(`Unknown environment "${name}"`);
      return def;
    },
    loadEnvironments: () => BUILTIN_ENVIRONMENTS,
    secretsPrefix: (def: MockEnvDef) => `portalai/${requireAws(def).envName}`,
    ssmPrefix: (def: MockEnvDef) => `/portalai/${requireAws(def).envName}`,
    clusterName: (def: MockEnvDef) => `portalai-${requireAws(def).envName}`,
    bastionExportName: (def: MockEnvDef) =>
      `${requireAws(def).envName}-BastionInstanceId`,
    envBanner: (def: MockEnvDef) => `[env: ${def.name} (${def.kind})]`,
    // I/O seams
    ...mocks,
  };
}
