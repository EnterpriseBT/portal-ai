/**
 * Typed errors — the agent-facing contract (#194).
 *
 * Consumers (the CLIs, CI, test harnesses, an AI agent driving a CLI) branch
 * on `code`, never on message prose: it maps to exit codes / `--json` error
 * payloads. Messages are for humans; codes are the API.
 */

export type CliEnvErrorCode =
  /** Unknown env name, or an AWS-only operation against an env with no AWS config. */
  | "ENV_NOT_CONFIGURED"
  /** No/expired session and refresh failed — run `login` / `aws sso login`. */
  | "ENV_NOT_AUTHORIZED"
  /** Destructive op against a production-kind env — never allowed. */
  | "ENV_DESTRUCTIVE_BLOCKED"
  /** Staging/production op lacking its explicit confirm flag. */
  | "ENV_CONFIRMATION_REQUIRED"
  /** AWS / tunnel / Auth0 transport failure (wraps the cause). */
  | "ENV_INFRA_ERROR";

export class CliEnvError extends Error {
  readonly code: CliEnvErrorCode;

  constructor(
    code: CliEnvErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.code = code;
    this.name = new.target.name;
  }
}

export class EnvNotConfiguredError extends CliEnvError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("ENV_NOT_CONFIGURED", message, options);
  }
}

export class EnvNotAuthorizedError extends CliEnvError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("ENV_NOT_AUTHORIZED", message, options);
  }
}

export class EnvDestructiveBlockedError extends CliEnvError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("ENV_DESTRUCTIVE_BLOCKED", message, options);
  }
}

export class EnvConfirmationRequiredError extends CliEnvError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("ENV_CONFIRMATION_REQUIRED", message, options);
  }
}

export class EnvInfraError extends CliEnvError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("ENV_INFRA_ERROR", message, options);
  }
}
