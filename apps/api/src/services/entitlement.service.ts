import { isBuiltinToolpackSlug } from "@portalai/core/registries";

import { DbService } from "./db.service.js";
import { TierService } from "./tier.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "entitlement-service" });

export interface BuiltinPackSplit {
  /** Configured ∩ entitled — the packs whose tools actually exist. */
  effective: string[];
  /** Configured \ entitled — configured, stripped, and nameable to the user. */
  unentitled: string[];
  /** The tier slug that resolved, for logs and denial messages. */
  tier: string;
}

/**
 * The single definition of "which built-in packs does this org actually
 * have" (#284).
 *
 * #214 shipped the entitlement *mechanism* — `TierPolicy.entitlements
 * .builtinToolpacks` — and one reader, inside `ToolService
 * .buildAnalyticsTools`. Three more consumers arrived with #284 (the station
 * write guard, `buildStationContext`, and the `station_context` tool), and
 * "configured ∩ entitled" computed four different ways is exactly how the
 * surfaces drift apart. It lives here once.
 *
 * Fail-closed by shape: an unresolvable tier policy throws rather than
 * returning a permissive default. A DB outage already fails whatever it was
 * serving, and a guard that failed open would reintroduce the silent state
 * this ticket removes. The *client* fails open (a stale side query must not
 * forbid legitimate work); the server does not.
 */
export class EntitlementService {
  /**
   * Split an org's configured built-in slugs by what its tier includes.
   * Input order is preserved in both lists.
   *
   * An empty `configuredSlugs` short-circuits: no org read, no tier resolve.
   * That keeps a rename-only station PATCH free of entitlement queries.
   */
  static async splitBuiltinPacks(
    organizationId: string,
    configuredSlugs: readonly string[]
  ): Promise<BuiltinPackSplit> {
    if (configuredSlugs.length === 0) {
      return { effective: [], unentitled: [], tier: "" };
    }

    const policy = await EntitlementService.resolvePolicy(organizationId);
    const entitled = new Set(policy.entitlements.builtinToolpacks);

    // A tier row may carry slugs for packs that ship in a later deploy.
    // They entitle nothing, but support needs to see them.
    const unknown = policy.entitlements.builtinToolpacks.filter(
      (s) => !isBuiltinToolpackSlug(s)
    );
    if (unknown.length > 0) {
      logger.warn(
        { slugs: unknown, tier: policy.tier },
        "Tier allowlist carries slugs unknown to the toolpack registry; ignoring them"
      );
    }

    const effective: string[] = [];
    const unentitled: string[] = [];
    for (const slug of configuredSlugs) {
      (entitled.has(slug) ? effective : unentitled).push(slug);
    }

    return { effective, unentitled, tier: policy.tier };
  }

  /** Whether the org's tier includes custom (webhook) toolpacks (#214). */
  static async customPacksEntitled(organizationId: string): Promise<boolean> {
    const policy = await EntitlementService.resolvePolicy(organizationId);
    return policy.entitlements.customToolpacks;
  }

  /**
   * Resolve the org's tier policy. A missing org row resolves the default
   * tier (`resolveTier` handles the empty slug), which keeps the behavior
   * identical to the pre-#284 reader in `tools.service.ts`.
   */
  private static async resolvePolicy(organizationId: string) {
    const org =
      await DbService.repository.organizations.findById(organizationId);
    return TierService.resolveTier(org ?? { tier: "" });
  }
}
