import { assertOperationAllowed, envBanner } from "../guard.js";
import {
  EnvConfirmationRequiredError,
  EnvDestructiveBlockedError,
} from "../errors.js";
import type { EnvironmentDefinition } from "../registry.js";

const env = (kind: EnvironmentDefinition["kind"]): EnvironmentDefinition => ({
  name: `test-${kind}`,
  kind,
  apiBaseUrl: "http://localhost:3001",
  aws: null,
});

const NO_FLAGS = { destructive: true, confirmed: false, prodConfirmed: false };

describe("assertOperationAllowed", () => {
  it("development: everything allowed, no flags needed", () => {
    expect(() => assertOperationAllowed(env("development"), NO_FLAGS)).not.toThrow();
  });

  it("staging: requires the confirm flag", () => {
    expect(() => assertOperationAllowed(env("staging"), NO_FLAGS)).toThrow(
      EnvConfirmationRequiredError
    );
  });

  it("staging: allowed (including destructive) once confirmed", () => {
    expect(() =>
      assertOperationAllowed(env("staging"), {
        destructive: true,
        confirmed: true,
        prodConfirmed: false,
      })
    ).not.toThrow();
  });

  it("production: destructive is blocked UNCONDITIONALLY — flags don't help", () => {
    expect(() =>
      assertOperationAllowed(env("production"), {
        destructive: true,
        confirmed: true,
        prodConfirmed: true,
      })
    ).toThrow(EnvDestructiveBlockedError);
  });

  it("production: non-destructive still requires the prod barrier flag", () => {
    expect(() =>
      assertOperationAllowed(env("production"), {
        destructive: false,
        confirmed: true,
        prodConfirmed: false,
      })
    ).toThrow(EnvConfirmationRequiredError);
  });

  it("production: non-destructive allowed with confirm + prod barrier", () => {
    expect(() =>
      assertOperationAllowed(env("production"), {
        destructive: false,
        confirmed: true,
        prodConfirmed: true,
      })
    ).not.toThrow();
  });

  it("errors carry stable codes (the agent-facing contract)", () => {
    try {
      assertOperationAllowed(env("production"), {
        destructive: true,
        confirmed: true,
        prodConfirmed: true,
      });
    } catch (err) {
      expect((err as EnvDestructiveBlockedError).code).toBe(
        "ENV_DESTRUCTIVE_BLOCKED"
      );
    }
    try {
      assertOperationAllowed(env("staging"), NO_FLAGS);
    } catch (err) {
      expect((err as EnvConfirmationRequiredError).code).toBe(
        "ENV_CONFIRMATION_REQUIRED"
      );
    }
  });
});

describe("envBanner", () => {
  it("renders the active env + kind every command echoes", () => {
    expect(envBanner(env("staging"))).toBe("[env: test-staging (staging)]");
  });
});
