/**
 * Where an e2e run points, and as whom (#489).
 *
 * `local` is the #304 dev stack (or the CI ephemeral stack); `app-dev` and
 * `prod` are the deployed apps, resolved from cli-env's built-in registry so
 * the URLs live in one place. Deployed targets sign in as that env's QA
 * identity through the build-flagged QA sign-in; the dev affordance doesn't
 * exist in a deployed build.
 */

import path from "node:path";

import {
  BUILTIN_ENVIRONMENTS,
  getSecret as cliEnvGetSecret,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

export type E2eTargetName = "local" | "app-dev" | "prod";
/** dev: `/?e2e=1` → "Dev sign-in (E2E)"; qa: `/login?qa=1` → "QA sign-in". */
export type SignInVia = "dev" | "qa";

export interface E2eTarget {
  name: E2eTargetName;
  baseUrl: string;
  apiBaseUrl: string;
  via: SignInVia;
  deployed: boolean;
}

export interface E2eCredentials {
  username: string;
  password: string;
}

/** A misconfigured run. Messages name variables, never their values. */
export class E2eConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "E2eConfigError";
  }
}

const TARGET_NAMES: readonly E2eTargetName[] = ["local", "app-dev", "prod"];

const isTargetName = (v: string): v is E2eTargetName =>
  (TARGET_NAMES as readonly string[]).includes(v);

/**
 * `E2E_TARGET` (default `local`). `E2E_BASE_URL` repoints the local target
 * only and is ignored for a deployed one (it's a local-stack setting, often
 * in `.env`), so a deployed target's credentials are only ever typed into
 * that env's own app. `E2E_SIGN_IN_VIA` picks the QA path locally, for the
 * CI stack's preview build, which has no dev affordance.
 */
export function resolveTarget(env: NodeJS.ProcessEnv = process.env): E2eTarget {
  const name = env.E2E_TARGET || "local";
  if (!isTargetName(name)) {
    throw new E2eConfigError(
      `Unknown E2E_TARGET "${name}" (expected local | app-dev | prod)`
    );
  }
  const def = BUILTIN_ENVIRONMENTS[name];
  const deployed = name !== "local";

  const viaRaw = env.E2E_SIGN_IN_VIA;
  if (viaRaw && viaRaw !== "dev" && viaRaw !== "qa") {
    throw new E2eConfigError(
      `Unknown E2E_SIGN_IN_VIA "${viaRaw}" (expected dev | qa)`
    );
  }
  const via: SignInVia = viaRaw
    ? (viaRaw as SignInVia)
    : deployed
      ? "qa"
      : "dev";
  if (deployed && via === "dev") {
    throw new E2eConfigError(
      `${name} has no dev affordance (it is stripped from deployed builds); sign in via qa`
    );
  }
  if (!def.webBaseUrl) {
    throw new E2eConfigError(`${name} has no webBaseUrl in cli-env`);
  }

  return {
    name,
    baseUrl: (deployed ? undefined : env.E2E_BASE_URL) || def.webBaseUrl,
    apiBaseUrl: def.apiBaseUrl,
    via,
    deployed,
  };
}

const identityKey = (identity: string): string =>
  identity.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

function refuseDeployedIdentity(target: E2eTarget, identity?: string): void {
  if (target.deployed && identity) {
    throw new E2eConfigError(
      `${target.name} has only the QA owner identity; --identity is local-only`
    );
  }
}

/**
 * Local: `.auth/storageState.json` (owner) or `.auth/<id>.storageState.json`,
 * the #304/#620 paths `.mcp.json` and `e2e:use` already read. Deployed:
 * `.auth/<env>/owner.storageState.json`, one directory per env so a deployed
 * session never overwrites the local one.
 */
export function storageStatePath(
  target: E2eTarget,
  identity?: string,
  root: string = process.cwd()
): string {
  refuseDeployedIdentity(target, identity);
  if (target.deployed) {
    return path.join(root, ".auth", target.name, "owner.storageState.json");
  }
  return path.join(
    root,
    ".auth",
    identity
      ? `${identity.toLowerCase()}.storageState.json`
      : "storageState.json"
  );
}

type GetSecret = (def: EnvironmentDefinition, name: string) => Promise<string>;

export interface ResolveCredentialsOptions {
  identity?: string;
  env?: NodeJS.ProcessEnv;
  /** Injected for tests; defaults to cli-env's Secrets Manager read. */
  getSecret?: GetSecret;
}

/**
 * Env vars first: `E2E_AUTH0_USERNAME[_<ID>]` / `E2E_AUTH0_PASSWORD[_<ID>]`
 * (the CI deploy job exports the QA pair). A deployed target without them
 * reads `portalai/<env>/qa-auth0-{username,password}` with ambient AWS
 * credentials.
 */
export async function resolveCredentials(
  target: E2eTarget,
  opts: ResolveCredentialsOptions = {}
): Promise<E2eCredentials> {
  const { identity, env = process.env, getSecret = cliEnvGetSecret } = opts;
  refuseDeployedIdentity(target, identity);

  const suffix = identity ? `_${identityKey(identity)}` : "";
  const userVar = `E2E_AUTH0_USERNAME${suffix}`;
  const passVar = `E2E_AUTH0_PASSWORD${suffix}`;
  const username = env[userVar];
  const password = env[passVar];
  if (username && password) return { username, password };

  if (target.deployed) {
    const def = BUILTIN_ENVIRONMENTS[target.name];
    const [u, p] = await Promise.all([
      getSecret(def, "qa-auth0-username"),
      getSecret(def, "qa-auth0-password"),
    ]);
    return { username: u, password: p };
  }

  const missing = [!username && userVar, !password && passVar].filter(Boolean);
  throw new E2eConfigError(
    `${missing.join(" and ")} must be set (the dev-tenant Database-connection test user). See packages/e2e/README.md.`
  );
}
