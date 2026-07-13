/**
 * Auth0 device-flow session — the app-API authorization path (#194,
 * Decision 2, confirmed in review).
 *
 * The human authorizes ONCE per environment (`login` — device authorization
 * grant: surface a code, confirm in a browser; works headless/SSH). The
 * session is cached in `~/.portalai/credentials.json` (0600, atomic writes),
 * then commands — or an AI agent driving the CLI — use `getToken` silently,
 * with transparent refresh. Actions therefore always attribute to the human
 * principal who authorized (the reason user tokens beat M2M here).
 *
 * Config per env: AWS envs read `auth0-domain` / `auth0-audience` /
 * `auth0-cli-client-id` from SSM; `local` reads AUTH0_DOMAIN /
 * AUTH0_AUDIENCE / AUTH0_CLI_CLIENT_ID from the process env (.env).
 */

import fs from "node:fs";
import path from "node:path";

import { getParam } from "./aws.js";
import { EnvNotAuthorizedError, EnvNotConfiguredError } from "./errors.js";
import { getEnvironment, portalaiDir } from "./registry.js";

const CREDENTIALS_FILE = "credentials.json";
/** Refresh this many ms before actual expiry so a token never dies mid-command. */
const EXPIRY_SLACK_MS = 60_000;

interface Auth0Config {
  domain: string;
  audience: string;
  clientId: string;
}

interface SessionEntry {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

type CredentialsFile = Record<string, SessionEntry>;

export interface LoginIo {
  /** Present the verification URI + user code to the human (the CLI decides
   *  how — print, open a browser, etc.). The only human step in the flow. */
  onUserCode(verificationUriComplete: string, userCode: string): void;
}

// ── Config resolution ────────────────────────────────────────────────

async function resolveAuth0Config(envName: string): Promise<Auth0Config> {
  const def = getEnvironment(envName);
  if (def.aws) {
    const [domain, audience, clientId] = await Promise.all([
      getParam(def, "auth0-domain"),
      getParam(def, "auth0-audience"),
      getParam(def, "auth0-cli-client-id"),
    ]);
    return { domain, audience, clientId };
  }
  const domain = process.env.AUTH0_DOMAIN;
  const audience = process.env.AUTH0_AUDIENCE;
  const clientId = process.env.AUTH0_CLI_CLIENT_ID;
  if (!domain || !audience || !clientId) {
    throw new EnvNotConfiguredError(
      `Environment "${envName}" needs AUTH0_DOMAIN, AUTH0_AUDIENCE and AUTH0_CLI_CLIENT_ID in the process env (.env)`
    );
  }
  return { domain, audience, clientId };
}

// ── Session cache (0600, atomic) ─────────────────────────────────────

function credentialsPath(): string {
  return path.join(portalaiDir(), CREDENTIALS_FILE);
}

function readCredentials(): CredentialsFile {
  const file = credentialsPath();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as CredentialsFile;
  } catch {
    return {}; // a corrupt cache means re-login, never a crash
  }
}

/** Atomic replace (temp + rename) so concurrent CLI/agent invocations can't
 *  interleave partial writes; last writer wins with a valid file either way. */
function writeCredentials(creds: CredentialsFile): void {
  const dir = portalaiDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = credentialsPath();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// ── Device authorization grant ───────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postForm(
  url: string,
  form: Record<string, string>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

/** Run the device flow for `envName` and cache the session. */
export async function login(envName: string, io?: LoginIo): Promise<void> {
  const config = await resolveAuth0Config(envName);
  const base = `https://${config.domain}`;

  const device = await postForm(`${base}/oauth/device/code`, {
    client_id: config.clientId,
    audience: config.audience,
    scope: "openid profile email offline_access",
  });
  if (device.body.error || !device.body.device_code) {
    // e.g. `invalid_request: Client "…" is not authorized to access resource
    // server "…"` — a provisioning gap (missing client grant / device-code
    // grant type). Surface Auth0's own description; never poll blind.
    throw new EnvNotAuthorizedError(
      `Device authorization for "${envName}" was rejected by ${config.domain}: ${
        (device.body.error_description as string) ??
        (device.body.error as string) ??
        `HTTP ${device.status}`
      }`
    );
  }
  const deviceCode = device.body.device_code as string;
  const userCode = device.body.user_code as string;
  const verificationUri = device.body.verification_uri_complete as string;
  let intervalS = Number(device.body.interval ?? 5);
  const expiresAtMs = Date.now() + Number(device.body.expires_in ?? 900) * 1000;

  io?.onUserCode(verificationUri, userCode);

  // Poll until the human confirms in the browser (or the code expires).
  for (;;) {
    if (Date.now() > expiresAtMs) {
      throw new EnvNotAuthorizedError(
        `Device code for "${envName}" expired before it was confirmed — run login again`
      );
    }
    const poll = await postForm(`${base}/oauth/token`, {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: config.clientId,
    });

    if (poll.body.access_token) {
      const creds = readCredentials();
      creds[envName] = {
        accessToken: poll.body.access_token as string,
        refreshToken: poll.body.refresh_token as string,
        expiresAt: Date.now() + Number(poll.body.expires_in ?? 0) * 1000,
      };
      writeCredentials(creds);
      return;
    }

    const error = poll.body.error as string | undefined;
    if (error === "authorization_pending") {
      await sleep(intervalS * 1000);
      continue;
    }
    if (error === "slow_down") {
      intervalS += 5;
      await sleep(intervalS * 1000);
      continue;
    }
    throw new EnvNotAuthorizedError(
      `Authorization for "${envName}" was not granted (${error ?? `HTTP ${poll.status}`})`
    );
  }
}

/** Clear the env's cached session (other envs' sessions are untouched). */
export async function logout(envName: string): Promise<void> {
  const creds = readCredentials();
  if (envName in creds) {
    delete creds[envName];
    writeCredentials(creds);
  }
}

/**
 * The cached access token for `envName`, refreshed transparently when stale.
 * No session / failed refresh → ENV_NOT_AUTHORIZED (run `login`).
 */
export async function getToken(envName: string): Promise<string> {
  const creds = readCredentials();
  const entry = creds[envName];
  if (!entry) {
    throw new EnvNotAuthorizedError(
      `No session for "${envName}" — run login first`
    );
  }

  if (entry.expiresAt - EXPIRY_SLACK_MS > Date.now()) {
    return entry.accessToken;
  }

  // Expired (or about to) — refresh.
  const config = await resolveAuth0Config(envName);
  const refreshed = await postForm(`https://${config.domain}/oauth/token`, {
    grant_type: "refresh_token",
    refresh_token: entry.refreshToken,
    client_id: config.clientId,
  });
  if (!refreshed.body.access_token) {
    throw new EnvNotAuthorizedError(
      `Session refresh for "${envName}" failed (${(refreshed.body.error as string) ?? `HTTP ${refreshed.status}`}) — run login again`
    );
  }

  const next = readCredentials(); // re-read: another invocation may have written
  next[envName] = {
    accessToken: refreshed.body.access_token as string,
    // Auth0 rotates refresh tokens when rotation is enabled; keep the old one otherwise.
    refreshToken:
      (refreshed.body.refresh_token as string) ?? entry.refreshToken,
    expiresAt: Date.now() + Number(refreshed.body.expires_in ?? 0) * 1000,
  };
  writeCredentials(next);
  return next[envName].accessToken;
}
