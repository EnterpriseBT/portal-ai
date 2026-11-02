/**
 * Domain-typed errors (#190) — extends the sibling CLIs' agent contract with
 * the app-data failure modes. Consumers branch on `code` / exit codes 8–9.
 */

export type AdminCliErrorCode =
  | "ADMIN_NOT_FOUND"
  | "ADMIN_CONFLICT"
  | "ADMIN_INVALID_INPUT";

export class AdminCliError extends Error {
  readonly code: AdminCliErrorCode;

  constructor(code: AdminCliErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

/** Organization / user / tier / membership not found (or soft-deleted). */
export class AdminNotFoundError extends AdminCliError {
  constructor(message: string) {
    super("ADMIN_NOT_FOUND", message);
  }
}

/** #936: input the app would refuse (an invalid org name, an empty update).
 *  A usage error: exit 2. */
export class AdminInvalidInputError extends AdminCliError {
  constructor(message: string) {
    super("ADMIN_INVALID_INPUT", message);
  }
}

/** Duplicate membership, org-name collision, etc. */
export class AdminConflictError extends AdminCliError {
  constructor(message: string) {
    super("ADMIN_CONFLICT", message);
  }
}
