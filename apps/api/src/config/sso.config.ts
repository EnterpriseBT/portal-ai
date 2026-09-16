import { environment } from "../environment.js";

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
 */
export type DeployMode = "saas" | "self_hosted";

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
  /** The deployment model. `saas` (default) or `self_hosted`. */
  static deployMode(): DeployMode {
    return environment.DEPLOY_MODE === "self_hosted" ? "self_hosted" : "saas";
  }

  /**
   * The trusted issuers. Parses `SSO_ISSUERS` (a JSON array of
   * `{ issuer, audience, alg? }`); when unset, derives the single Auth0 issuer
   * from `AUTH0_DOMAIN` + `AUTH0_AUDIENCE` so the SaaS default is unchanged.
   * Throws on malformed/invalid `SSO_ISSUERS` (a boot-time misconfiguration).
   */
  static issuers(): IssuerConfig[] {
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
}
