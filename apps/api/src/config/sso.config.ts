import { environment } from "../environment.js";
import { isResidency } from "./deploy-mode.js";

/**
 * Enterprise SSO configuration authority (#577).
 *
 * The OIDC identity seam is config-driven: a list of trusted issuers (each with
 * its audience + signing alg), a deploy-mode discriminator, and an optional
 * list of invite-gated enterprise connections (#916). Everything defaults to today's single
 * Auth0 tenant, so with no SSO env set the behavior is unchanged — this is the
 * SaaS default. `self_hosted` installs point at the customer's own OIDC (or a
 * bundled issuer) via SSO_ISSUERS.
 *
 * Methods read `environment` on each call (no module-load caching), so a test
 * can vary the env by mocking the environment module.
 *
 * The deploy mode itself (`saas` | `residency`) is owned by `deploy-mode.ts`
 * (#579/#616) — this file consumes `isResidency()` rather than defining its own.
 */

/**
 * What `ensureProvisioned` does for an authenticated user who has no membership
 * and matched no invitation:
 * - `personal_org`  — provision a personal owner-org (today's SaaS self-serve).
 * - `join_single_org` — residency: join the one org tree (first user → owner).
 * - `deny` — SaaS login through a listed enterprise connection with no
 *   invite: reject, no org created (#916).
 */
export type ProvisioningFallback = "personal_org" | "join_single_org" | "deny";

/** Auth0's connection-name rule: alphanumerics and dashes, starting and
 *  ending alphanumeric, at most 128 characters. */
const CONNECTION_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,126}[A-Za-z0-9])?$/;

export interface IssuerConfig {
  /** The exact `iss` claim value to trust (Auth0 carries a trailing slash). */
  issuer: string;
  audience: string;
  /** JWT signing algorithm; defaults to RS256. */
  alg: string;
}

export class SsoConfig {
  /**
   * The trusted issuers, mode-gated (#616):
   * - **residency** → the single customer OIDC issuer (`OIDC_ISSUER` /
   *   `OIDC_AUDIENCE`); the deploy-mode boot guard guarantees both are set.
   * - **saas** → parse `SSO_ISSUERS` (a JSON array of `{ issuer, audience,
   *   alg? }`); when unset, derive the single Auth0 issuer from `AUTH0_DOMAIN`
   *   + `AUTH0_AUDIENCE` so the SaaS default is unchanged.
   * Throws on malformed/invalid `SSO_ISSUERS` (a boot-time misconfiguration).
   */
  static issuers(): IssuerConfig[] {
    if (isResidency()) {
      return [
        {
          issuer: environment.OIDC_ISSUER,
          audience: environment.OIDC_AUDIENCE,
          alg: "RS256",
        },
      ];
    }
    const raw = environment.SSO_ISSUERS;
    if (raw && raw.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new Error(
          `SSO_ISSUERS is not valid JSON: ${(e as Error).message}`
        );
      }
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error(
          "SSO_ISSUERS must be a non-empty JSON array of { issuer, audience, alg? }"
        );
      }
      return parsed.map((entry, i) => {
        if (typeof entry !== "object" || entry === null) {
          throw new Error(`SSO_ISSUERS[${i}] must be an object`);
        }
        const { issuer, audience, alg } = entry as Record<string, unknown>;
        if (typeof issuer !== "string" || !issuer) {
          throw new Error(`SSO_ISSUERS[${i}].issuer is required`);
        }
        if (typeof audience !== "string" || !audience) {
          throw new Error(`SSO_ISSUERS[${i}].audience is required`);
        }
        if (alg !== undefined && typeof alg !== "string") {
          throw new Error(`SSO_ISSUERS[${i}].alg must be a string`);
        }
        return { issuer, audience, alg: (alg as string) || "RS256" };
      });
    }

    if (environment.AUTH0_DOMAIN && environment.AUTH0_AUDIENCE) {
      return [
        {
          issuer: `https://${environment.AUTH0_DOMAIN}/`,
          audience: environment.AUTH0_AUDIENCE,
          alg: "RS256",
        },
      ];
    }
    return [];
  }

  /** Whether at least one issuer resolves. Never throws (mirrors StripeService.isConfigured). */
  static isConfigured(): boolean {
    try {
      return SsoConfig.issuers().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * The Auth0 enterprise connections whose logins are invite-gated (#916),
   * from `SSO_ENTERPRISE_CONNECTIONS`: a comma-separated list of connection
   * names. Unset, blank or exactly `none` means gating is off (`none` exists
   * because SSM can't store an empty value). Throws on a malformed list, and
   * boot calls this so a typo refuses to start rather than silently ungating.
   */
  static enterpriseConnections(): ReadonlySet<string> {
    const raw = environment.SSO_ENTERPRISE_CONNECTIONS?.trim();
    if (!raw || raw === "none") return new Set();
    const names = raw.split(",").map((entry) => entry.trim());
    names.forEach((name, i) => {
      if (name === "none") {
        throw new Error(
          `SSO_ENTERPRISE_CONNECTIONS[${i}]: "none" turns gating off and must be the whole value`
        );
      }
      if (!CONNECTION_NAME.test(name)) {
        throw new Error(
          `SSO_ENTERPRISE_CONNECTIONS[${i}] "${name}" is not a valid Auth0 connection name`
        );
      }
    });
    return new Set(names);
  }

  /**
   * The connection segment of an Auth0 user id (#916). Enterprise ids are
   * `<strategy>|<connection>|<id>`; social and database ids
   * (`google-oauth2|…`, `auth0|…`) have no connection segment, so they map to
   * null and can never be gated. The sub is signed into the verified access
   * token, so this needs no post-login Action (#873).
   */
  static connectionOf(sub: unknown): string | null {
    if (typeof sub !== "string") return null;
    const segments = sub.split("|");
    if (segments.length < 3 || !segments[1]) return null;
    return segments[1];
  }

  /**
   * The provisioning fallback for an authenticated user with no membership and
   * no matched invitation, decided from deploy mode + the token payload:
   * - residency → `join_single_org`;
   * - saas + a login through a listed enterprise connection → `deny`;
   * - otherwise (saas self-serve) → `personal_org`.
   */
  static provisioningFallback(
    payload: Record<string, unknown> | undefined
  ): ProvisioningFallback {
    if (isResidency()) return "join_single_org";
    const connection = SsoConfig.connectionOf(payload?.sub);
    if (connection && SsoConfig.enterpriseConnections().has(connection))
      return "deny";
    return "personal_org";
  }
}
