/**
 * Runtime identity configuration (#607).
 *
 * A single residency web image is built once and serves any customer: it must
 * decide *at runtime* whether to authenticate against Auth0 (SaaS) or a generic
 * OIDC issuer (a customer's own, or the bundled fallback), with no rebuild.
 * `config.js` (#566) injects `window.__RUNTIME_CONFIG__` before the bundle
 * loads; this module is the typed reader consumers use.
 *
 * Two config sources, split by where the value legitimately lives:
 *  - **Auth0 (SaaS/dev)** — `VITE_AUTH0_*`, baked into the bundle at build time
 *    (our own Auth0 tenant; safe to bake because we build the SaaS image).
 *  - **OIDC (residency)** — `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_AUDIENCE`
 *    from the runtime config (the customer's issuer; must NOT be baked in).
 *
 * SECURITY: only non-secret, client-visible values are read here. The runtime
 * config carries a public issuer / client id / audience; a client secret must
 * never be added (a SPA is a PKCE public client). Unknown keys are ignored, so
 * a stray secret in `config.js` is never surfaced.
 */

export type AuthProviderKind = "auth0" | "oidc";
export type DeployMode = "saas" | "residency";

/** The non-secret runtime identity config. Mirrors `render-config.mjs` RUNTIME_KEYS. */
export interface RuntimeConfig {
  authProvider: AuthProviderKind;
  deployMode: DeployMode;
  oidcIssuer: string;
  oidcClientId: string;
  oidcAudience: string;
}

/** Auth0 provider settings — build-time `VITE_AUTH0_*` (SaaS/dev authority). */
export interface Auth0Settings {
  domain: string;
  clientId: string;
  audience: string;
  /** #489: Auth0 connection for the deployed QA identity; "" ⇒ no QA sign-in. */
  qaConnection: string;
}

/** OIDC provider settings — runtime `OIDC_*` (residency authority). */
export interface OidcSettings {
  issuer: string;
  clientId: string;
  audience: string;
}

/** Thrown when a residency (`oidc`) build is missing required OIDC config. */
export class RuntimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigError";
  }
}

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * Map the raw runtime-config object to the typed shape. Pure over its source so
 * it is directly testable; only the five known keys are read, so any extra key
 * (including a stray secret) is dropped.
 */
export function readRuntimeConfig(
  source: Record<string, unknown> | undefined
): RuntimeConfig {
  const raw = source ?? {};
  return {
    authProvider: str(raw.AUTH_PROVIDER) === "oidc" ? "oidc" : "auth0",
    deployMode: str(raw.DEPLOY_MODE) === "residency" ? "residency" : "saas",
    oidcIssuer: str(raw.OIDC_ISSUER),
    oidcClientId: str(raw.OIDC_CLIENT_ID),
    oidcAudience: str(raw.OIDC_AUDIENCE),
  };
}

/** The live accessor — reads `window.__RUNTIME_CONFIG__` (absent ⇒ SaaS defaults). */
export function getRuntimeConfig(): RuntimeConfig {
  return readRuntimeConfig(
    typeof window !== "undefined" ? window.__RUNTIME_CONFIG__ : undefined
  );
}

/**
 * The install-wide map basemap (#910), operator-set via the runtime config.
 * `default` is today's SaaS behaviour (CARTO by theme, or the spec's own
 * choice); `custom` and `none` override every map spec's basemap, so no stored
 * pin or agent-authored spec can reach a host the operator didn't configure.
 */
export type InstallBasemap =
  | { mode: "default" }
  | { mode: "none" }
  | {
      mode: "custom";
      /** A MapLibre style JSON URL, or a raster XYZ `{z}/{x}/{y}` template. */
      styleUrl: string;
      styleUrlDark: string | null;
      attribution: string;
    };

export interface InstallBasemapResult {
  basemap: InstallBasemap;
  /** Why the raw config was rejected (→ `none`); null when it parsed as given. */
  problem: string | null;
}

const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Pure parse of the `BASEMAP_*` keys. Fail-closed (#910 D4): a config this
 * can't read as given resolves to `none` — losing a basemap is cosmetic, while
 * falling back to CARTO would be third-party egress a residency install never
 * agreed to.
 */
export function readInstallBasemap(
  source: Record<string, unknown> | undefined
): InstallBasemapResult {
  const raw = source ?? {};
  const mode = str(raw.BASEMAP_MODE).trim();
  if (mode === "" || mode === "default") {
    return { basemap: { mode: "default" }, problem: null };
  }
  if (mode === "none") return { basemap: { mode: "none" }, problem: null };
  if (mode !== "custom") {
    return {
      basemap: { mode: "none" },
      problem: `Unknown BASEMAP_MODE "${mode}" (expected default, custom or none); rendering maps without a basemap.`,
    };
  }

  const styleUrl = str(raw.BASEMAP_STYLE_URL).trim();
  if (!isHttpUrl(styleUrl)) {
    return {
      basemap: { mode: "none" },
      problem:
        "BASEMAP_MODE is custom but BASEMAP_STYLE_URL is not an absolute http(s) URL; rendering maps without a basemap.",
    };
  }
  const dark = str(raw.BASEMAP_STYLE_URL_DARK).trim();
  const darkValid = dark === "" || isHttpUrl(dark);
  return {
    basemap: {
      mode: "custom",
      styleUrl,
      styleUrlDark: dark !== "" && darkValid ? dark : null,
      attribution: str(raw.BASEMAP_ATTRIBUTION).trim(),
    },
    problem: darkValid
      ? null
      : "BASEMAP_STYLE_URL_DARK is not an absolute http(s) URL; using BASEMAP_STYLE_URL in both themes.",
  };
}

const warnedBasemapProblems = new Set<string>();

/** The live accessor; warns once per distinct problem rather than per map. */
export function getInstallBasemap(): InstallBasemap {
  const { basemap, problem } = readInstallBasemap(
    typeof window !== "undefined" ? window.__RUNTIME_CONFIG__ : undefined
  );
  if (problem && !warnedBasemapProblems.has(problem)) {
    warnedBasemapProblems.add(problem);
    console.warn(`[basemap] ${problem}`);
  }
  return basemap;
}

interface ViteAuthEnv {
  VITE_AUTH0_DOMAIN?: string;
  VITE_AUTH0_CLIENT_ID?: string;
  VITE_AUTH0_AUDIENCE?: string;
  VITE_AUTH0_QA_CONNECTION?: string;
}

/**
 * Pure Auth0-settings map. Exported for its own test: `import.meta.env` is
 * Vite-only and per-module, so the resolution is testable only as a pure
 * function (mirrors `contact.util`, #369).
 */
export function readAuth0Settings(env: ViteAuthEnv | undefined): Auth0Settings {
  return {
    domain: env?.VITE_AUTH0_DOMAIN ?? "",
    clientId: env?.VITE_AUTH0_CLIENT_ID ?? "",
    audience: env?.VITE_AUTH0_AUDIENCE ?? "",
    qaConnection: env?.VITE_AUTH0_QA_CONNECTION?.trim() ?? "",
  };
}

/**
 * Whether the login page offers the QA sign-in (#489): the build names a QA
 * Database connection (`VITE_AUTH0_QA_CONNECTION`, set only by builds that
 * opt in) AND the URL asks for it with `?qa`. Never under residency OIDC.
 * The affordance adds no exposure of its own — a connection enabled on the
 * app is reachable by a crafted `/authorize` URL anyway; the guard is the
 * connection's own settings (sign-ups off, one user).
 */
export function shouldShowQaLogin(args: {
  isOidc: boolean;
  qaConnection: string;
  search: string;
}): boolean {
  return (
    !args.isOidc &&
    args.qaConnection !== "" &&
    new URLSearchParams(args.search).has("qa")
  );
}

/** Auth0 provider settings from the build-time env (dev-only fallback path). */
export function resolveAuth0Settings(): Auth0Settings {
  // `import.meta.env` does not exist outside a Vite build (jest, node scripts);
  // reading it here degrades to empty fields rather than throwing.
  return readAuth0Settings(import.meta.env as ViteAuthEnv | undefined);
}

/**
 * OIDC provider settings from the runtime config. Fail-closed (#607 D5): a
 * residency (`oidc`) build with any blank OIDC field throws rather than
 * silently falling back to Auth0 or anonymous — a residency install must never
 * authenticate against our tenant by accident.
 */
export function resolveOidcSettings(cfg: RuntimeConfig): OidcSettings {
  const settings: OidcSettings = {
    issuer: cfg.oidcIssuer,
    clientId: cfg.oidcClientId,
    audience: cfg.oidcAudience,
  };
  if (cfg.authProvider === "oidc") {
    const missing = (Object.entries(settings) as [keyof OidcSettings, string][])
      .filter(([, value]) => !value.trim())
      .map(([key]) => key);
    if (missing.length > 0) {
      throw new RuntimeConfigError(
        `Residency OIDC config incomplete: missing ${missing.join(", ")}. ` +
          `Set OIDC_ISSUER, OIDC_CLIENT_ID, and OIDC_AUDIENCE in the runtime config.`
      );
    }
  }
  return settings;
}
