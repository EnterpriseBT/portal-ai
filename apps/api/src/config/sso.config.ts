import { environment } from "../environment.js";
import { isResidency } from "./deploy-mode.js";

/**
 * Enterprise SSO configuration authority (#577).
 *
 * The OIDC identity seam is config-driven: a list of trusted issuers (each with
 * its audience + signing alg), a deploy-mode discriminator, and an optional
 * "enterprise-federated" claim marker. Everything defaults to today's single
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
 * - `deny` — SaaS enterprise-federated with no invite: reject, no org created.
 */
export type ProvisioningFallback = "personal_org" | "join_single_org" | "deny";

export interface IssuerConfig {
  /** The exact `iss` claim value to trust (Auth0 carries a trailing slash). */
  issuer: string;
  audience: string;
  /** JWT signing algorithm; defaults to RS256. */
  alg: string;
}

export interface EnterpriseClaimConfig {
  /** The claim name that marks a token as enterprise-federated. */
  name: string;
  /** When set, the claim must equal this value; when absent, presence suffices. */
  value?: string;
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

  /** The enterprise-federated claim marker, or null when unconfigured. */
  static enterpriseClaim(): EnterpriseClaimConfig | null {
    const name = environment.SSO_ENTERPRISE_CLAIM;
    if (!name || !name.trim()) return null;
    const value = environment.SSO_ENTERPRISE_CLAIM_VALUE;
    return value && value.trim() ? { name, value } : { name };
  }

  /** Whether a token's payload carries the configured enterprise-federated marker. */
  private static isEnterpriseFederated(
    payload: Record<string, unknown> | undefined,
    claim: EnterpriseClaimConfig
  ): boolean {
    if (!payload) return false;
    const actual = payload[claim.name];
    if (actual === undefined || actual === null) return false;
    return claim.value === undefined ? true : actual === claim.value;
  }

  /**
   * The provisioning fallback for an authenticated user with no membership and
   * no matched invitation, decided from deploy mode + the token payload:
   * - residency → `join_single_org`;
   * - saas + a configured enterprise claim the token carries → `deny`;
   * - otherwise (saas self-serve) → `personal_org`.
   */
  static provisioningFallback(
    payload: Record<string, unknown> | undefined
  ): ProvisioningFallback {
    if (isResidency()) return "join_single_org";
    const claim = SsoConfig.enterpriseClaim();
    if (claim && SsoConfig.isEnterpriseFederated(payload, claim)) return "deny";
    return "personal_org";
  }
}
