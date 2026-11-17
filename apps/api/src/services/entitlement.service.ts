import type { TierPolicy } from "@portalai/core/models";
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

/** One org-registered (webhook) toolpack, as an inventory entry (#306). */
export interface CustomPackSummary {
  /** The pack's registered slug-shaped name, e.g. `smoke`. */
  name: string;
  description: string | null;
  /** The tool names the pack provides, in registration order. */
  toolNames: string[];
}

/** A station's packs: the built-in split plus its custom packs (#306). */
export interface StationPacks extends BuiltinPackSplit {
  /**
   * #848: built-in packs the org's plan includes that this station is not
   * configured with, in the plan's order. The system prompt names them so the
   * agent can say which pack a request needs and point at a station that has
   * it, instead of calling the request impossible.
   */
  otherPlanPacks: string[];
  /**
   * #848: how many custom packs are attached to the station, whether or not
   * the plan includes custom packs. A station carrying only these still has
   * packs; whether they build any tools is `customPacksEntitled`.
   */
  configuredCustomPackCount: number;
  /** Whether the plan includes custom packs (#214). When it doesn't, the
   *  attached ones build no tools and `customPacks` is empty. */
  customPacksEntitled: boolean;
  /**
   * Registered custom packs attached to this station. Empty when the org's
   * tier does not include custom toolpacks (#214) — their tools are not
   * constructed in that case, so naming them would describe nothing.
   */
  customPacks: CustomPackSummary[];
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
    return EntitlementService.splitByPolicy(policy, configuredSlugs);
  }

  /** The split itself, against a policy the caller already resolved. */
  private static splitByPolicy(
    policy: TierPolicy,
    configuredSlugs: readonly string[]
  ): BuiltinPackSplit {
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

  /**
   * The single derivation of what packs a station actually has — built-in
   * **and** custom (#306).
   *
   * Before this, three paths answered the question from `builtinSlug` alone
   * while `ToolService.buildAnalyticsTools` correctly read both columns. So a
   * registered custom pack was attached and callable but absent from every
   * inventory the agent reads, and the agent denied tools it held. Worse,
   * `splitBuiltinPacks` classifies any non-builtin ref as *unentitled*, so a
   * custom pack that did reach it would be reported to the user as a plan
   * limit — which is where the spurious "check Subscription & Billing"
   * guidance came from.
   *
   * Custom packs are omitted entirely when the tier's `customToolpacks`
   * entitlement is false, matching #214: registrations survive a downgrade,
   * their tools stop being offered, so the inventory must stop naming them.
   */
  static async resolveStationPacks(
    stationId: string,
    organizationId: string,
    // `platform_help` needs the count and the entitlement only. The row read
    // decrypts stored pack credentials, so a caller that doesn't use the
    // summaries skips it and gets `customPacks: []`.
    options: { customPackSummaries?: boolean } = {}
  ): Promise<StationPacks> {
    const rows =
      await DbService.repository.stationToolpacks.findByStationId(stationId);

    const builtinSlugs = rows
      .map((r) => r.builtinSlug)
      .filter((s): s is string => s !== null);
    const customPackIds = rows
      .map((r) => r.organizationToolpackId)
      .filter((id): id is string => id !== null);

    // One org read and one tier resolve serve the split, the plan's other
    // packs (#848) and the custom-pack entitlement: this runs on every turn.
    const policy = await EntitlementService.resolvePolicy(organizationId);
    const { effective, unentitled, tier } = EntitlementService.splitByPolicy(
      policy,
      builtinSlugs
    );

    const configured = new Set(builtinSlugs);
    const otherPlanPacks = policy.entitlements.builtinToolpacks.filter(
      (slug) => isBuiltinToolpackSlug(slug) && !configured.has(slug)
    );

    const base = {
      effective,
      unentitled,
      otherPlanPacks,
      configuredCustomPackCount: customPackIds.length,
      customPacksEntitled: policy.entitlements.customToolpacks,
      tier,
    };

    // Gate before the lookup: an unentitled org shouldn't pay for the read.
    if (
      customPackIds.length === 0 ||
      !policy.entitlements.customToolpacks ||
      options.customPackSummaries === false
    ) {
      return { ...base, customPacks: [] };
    }

    const packs =
      await DbService.repository.organizationToolpacks.findManyByIds(
        customPackIds,
        { organizationId }
      );

    return {
      ...base,
      customPacks: packs.map((p) => ({
        name: p.name,
        description: p.description,
        toolNames: p.tools.map((t) => t.name),
      })),
    };
  }

  /** Whether the org's tier includes custom RBAC authoring (#622). */
  static async customRbacEntitled(organizationId: string): Promise<boolean> {
    const policy = await EntitlementService.resolvePolicy(organizationId);
    return policy.entitlements.customRbac;
  }

  /** Whether the org's tier includes advanced (SQL) view filters (#644). */
  static async advancedViewFiltersEntitled(
    organizationId: string
  ): Promise<boolean> {
    const policy = await EntitlementService.resolvePolicy(organizationId);
    return policy.entitlements.advancedViewFilters;
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
