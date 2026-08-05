/**
 * BusinessConfigService (#311) — the runtime reader for operator-owned
 * business config (the `portalops vars` SSM catalog).
 *
 * Why runtime SSM and not env vars alone: `environment.ts` is populated by
 * ECS at task start (`backend.yml` `Secrets`/`ValueFrom`), so a
 * `portalops vars set` would not reach a running task until it recycles —
 * which would make an email typo a deploy event (discovery Decision 3).
 * Reading SSM here, TTL-cached, keeps `GET /api/public/site-config` the
 * single live definition.
 *
 * Fail-SOFT by contract: any SSM error, a missing parameter, or an unset
 * `BUSINESS_CONFIG_SSM_PREFIX` falls back to the env vars — never throws.
 * A stale support email is strictly better than a 503 on the public
 * endpoint. Local dev runs with the prefix unset and needs no AWS
 * credentials.
 */

import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";

import { environment } from "../environment.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "business-config-service" });

/** Contact facts served on the public site-config snapshot. */
export interface ContactConfig {
  supportEmail: string;
  salesEmail: string;
}

/** 5 min — bounds SSM load regardless of request rate (the endpoint's own
 *  snapshot cache sits in front of this too). */
const CONTACT_CACHE_TTL_MS = 300_000;

/** SSM leaf names — MUST match the `portalops` catalog
 *  (`packages/devops-cli/src/catalog.ts`) exactly. */
const SUPPORT_EMAIL_LEAF = "support-email";
const SALES_EMAIL_LEAF = "sales-email";

interface ContactCacheEntry {
  value: ContactConfig;
  expires: number;
}

export class BusinessConfigService {
  private static client: SSMClient | null = null;
  private static cache: ContactCacheEntry | null = null;

  /** Lazy singleton — never constructed when the prefix is unset. */
  private static ssm(): SSMClient {
    if (!BusinessConfigService.client) {
      BusinessConfigService.client = new SSMClient({});
    }
    return BusinessConfigService.client;
  }

  /**
   * The contact addresses, SSM-first with per-key env fallback, TTL-cached.
   * Never throws.
   */
  static async getContact(): Promise<ContactConfig> {
    const now = Date.now();
    const cached = BusinessConfigService.cache;
    if (cached && cached.expires > now) {
      return cached.value;
    }

    const fallback: ContactConfig = {
      supportEmail: environment.SUPPORT_EMAIL,
      salesEmail: environment.SALES_EMAIL,
    };

    const prefix = environment.BUSINESS_CONFIG_SSM_PREFIX;
    let value = fallback;
    if (prefix) {
      const supportPath = `${prefix}/${SUPPORT_EMAIL_LEAF}`;
      const salesPath = `${prefix}/${SALES_EMAIL_LEAF}`;
      try {
        const result = await BusinessConfigService.ssm().send(
          new GetParametersCommand({ Names: [supportPath, salesPath] })
        );
        const byName = new Map(
          (result.Parameters ?? []).map((p) => [p.Name, p.Value])
        );
        // Per-key fallback: a missing parameter degrades that key only.
        value = {
          supportEmail: byName.get(supportPath) ?? fallback.supportEmail,
          salesEmail: byName.get(salesPath) ?? fallback.salesEmail,
        };
        if (result.InvalidParameters?.length) {
          logger.warn(
            { invalidParameters: result.InvalidParameters },
            "Business-config SSM parameters missing; using env fallback for them"
          );
        }
      } catch (error) {
        logger.warn(
          { error, prefix },
          "Business-config SSM read failed; falling back to env vars"
        );
      }
    }

    BusinessConfigService.cache = {
      value,
      expires: now + CONTACT_CACHE_TTL_MS,
    };
    return value;
  }

  /** Test seam. */
  static clearCache(): void {
    BusinessConfigService.cache = null;
    BusinessConfigService.client = null;
  }
}
