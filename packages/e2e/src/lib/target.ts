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

/** The QA identities each deployed env has (one QA org: its owner, an
 *  invited admin and an invited member). Locally any named role works. */
export type E2eIdentity = "owner" | "admin" | "member";
const DEPLOYED_IDENTITIES: readonly E2eIdentity[] = [
  "owner",
  "admin",
  "member",
];

const identityKey = (identity: string): string =>
  identity.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

/** The identity's canonical name: lowercased, with "owner" for none. A
 *  deployed target refuses a name it has no QA user for. */
const IDENTITY_NAME = /^[a-z0-9][a-z0-9_-]*$/;

export function normalizeIdentity(
  target: E2eTarget,
  identity?: string
): string {
  const name = identity ? identity.toLowerCase() : "owner";
  if (
    target.deployed &&
    !(DEPLOYED_IDENTITIES as readonly string[]).includes(name)
  ) {
    throw new E2eConfigError(
      `${target.name} has no QA identity "${name}" (expected owner | admin | member)`
    );
  }
  // The name becomes a file name under .auth/, so it can't carry a path.
  if (!IDENTITY_NAME.test(name)) {
    throw new E2eConfigError(
      `"${identity}" isn't an identity name (letters, digits, "-" and "_")`
    );
  }
  return name;
}

const authDir = (target: E2eTarget, root: string): string =>
  target.deployed
    ? path.join(root, ".auth", target.name)
    : path.join(root, ".auth");

/**
 * One state per identity: `.auth/<id>.storageState.json` locally (the #620
 * paths, now the owner's too) and `.auth/<env>/<id>.storageState.json` for a
 * deployed env, one directory per env so a deployed session never overwrites
 * the local one.
 */
export function storageStatePath(
  target: E2eTarget,
  identity?: string,
  root: string = process.cwd()
): string {
  return path.join(
    authDir(target, root),
    `${normalizeIdentity(target, identity)}.storageState.json`
  );
}

/** The state an env's Playwright MCP server loads (`.mcp.json`): the owner's
 *  after `e2e:auth`, or whichever identity `e2e:use` switched to. */
export function activeStorageStatePath(
  target: E2eTarget,
  root: string = process.cwd()
): string {
  return path.join(authDir(target, root), "storageState.json");
}

type GetSecret = (def: EnvironmentDefinition, name: string) => Promise<string>;

export interface ResolveCredentialsOptions {
  identity?: string;
  env?: NodeJS.ProcessEnv;
  /** Injected for tests; defaults to cli-env's Secrets Manager read. */
  getSecret?: GetSecret;
}

/**
 * Local: `E2E_AUTH0_USERNAME[_<ID>]` / `E2E_AUTH0_PASSWORD[_<ID>]`, the
 * dev-tenant users in `.env`. Deployed: `E2E_QA_AUTH0_USERNAME[_<ID>]` /
 * `E2E_QA_AUTH0_PASSWORD[_<ID>]` if both are set (the post-deploy job exports
 * the owner's pair), else `portalai/<env>/qa-auth0-{username,password}[-<id>]`
 * with ambient AWS credentials. The owner is the unsuffixed pair.
 */
export async function resolveCredentials(
  target: E2eTarget,
  opts: ResolveCredentialsOptions = {}
): Promise<E2eCredentials> {
  const { env = process.env, getSecret = cliEnvGetSecret } = opts;
  const identity = normalizeIdentity(target, opts.identity);

  const suffix = identity === "owner" ? "" : `_${identityKey(identity)}`;
  // A deployed env's QA identity has its own variable names. The local
  // E2E_AUTH0_* pair lives in packages/e2e/.env, which every script loads, and
  // must never be typed into another tenant's login.
  const prefix = target.deployed ? "E2E_QA_AUTH0" : "E2E_AUTH0";
  const userVar = `${prefix}_USERNAME${suffix}`;
  const passVar = `${prefix}_PASSWORD${suffix}`;
  const username = env[userVar];
  const password = env[passVar];
  if (username && password) return { username, password };

  if (target.deployed) {
    const def = BUILTIN_ENVIRONMENTS[target.name];
    const secretSuffix = identity === "owner" ? "" : `-${identity}`;
    const [u, p] = await Promise.all([
      getSecret(def, `qa-auth0-username${secretSuffix}`),
      getSecret(def, `qa-auth0-password${secretSuffix}`),
    ]);
    return { username: u, password: p };
  }

  const missing = [!username && userVar, !password && passVar].filter(Boolean);
  throw new E2eConfigError(
    `${missing.join(" and ")} must be set (the dev-tenant Database-connection test user). See packages/e2e/README.md.`
  );
}

export interface ResolveQaOrgIdOptions {
  env?: NodeJS.ProcessEnv;
  /** Injected for tests; defaults to cli-env's Secrets Manager read. */
  getSecret?: GetSecret;
}

/**
 * The org a target's QA identity must be in (#489). Counting memberships
 * isn't enough: a QA user removed from the QA org self-provisions a new one
 * on its next sign-in and has exactly one membership again.
 *
 * Deployed: `E2E_QA_ORG_ID` if set (the post-deploy job exports it), else
 * `portalai/<env>/qa-org-id`. It sits with the QA identity's secrets so the
 * deploy role reads it with the grant it already has. Local: `E2E_ORG_ID`, or
 * nothing, since a CI run provisions a fresh org each time. As with the
 * credentials, the local name never stands in for a deployed one.
 */
export async function resolveQaOrgId(
  target: E2eTarget,
  opts: ResolveQaOrgIdOptions = {}
): Promise<string | undefined> {
  const { env = process.env, getSecret = cliEnvGetSecret } = opts;
  if (!target.deployed) return env.E2E_ORG_ID || undefined;
  if (env.E2E_QA_ORG_ID) return env.E2E_QA_ORG_ID;
  return getSecret(BUILTIN_ENVIRONMENTS[target.name], "qa-org-id");
}
