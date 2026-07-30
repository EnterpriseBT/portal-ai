import { useMemo } from "react";

import { sdk } from "../api/sdk";
import { ALL_BUILTIN_SLUGS, isBuiltinPackEntitled } from "./tool-packs.util";

export interface BuiltinEntitlements {
  /**
   * The built-in pack slugs the organization's plan includes. Falls back
   * to {@link ALL_BUILTIN_SLUGS} whenever the tier policy isn't available.
   */
  entitledSlugs: ReadonlySet<string>;
  /** {@link isBuiltinPackEntitled} curried over `entitledSlugs`. */
  isEntitled: (pack: string) => boolean;
  /**
   * True until the usage query resolves. Informational only — the fallback
   * is already permissive, so callers do not need to gate on it.
   */
  isLoading: boolean;
}

/**
 * Read the organization's built-in toolpack entitlements (#284).
 *
 * Sourced from the tier policy that `GET /api/organization/usage` already
 * ships (#172) — the same react-query cache entry the Settings, Toolpacks,
 * and Portal surfaces hold, so this adds **zero** fetches no matter how
 * many chips mount.
 *
 * Fails **open**: with no data (loading, error, offline) every built-in
 * reads as entitled. A failed side query must never disable a legitimate
 * action; the server guard (`403 STATION_TOOLPACK_NOT_ENTITLED`) is the
 * gate, so the worst case is a readable error instead of a UI that
 * silently forbids work it can't justify. Mirrors #214's `?? true`.
 */
export function useBuiltinEntitlements(): BuiltinEntitlements {
  const usageResult = sdk.organizations.usage();
  // Guard every level, not just `data`: a payload carrying a `tier` without
  // `entitlements` must fail open like any other missing data. Chaining only
  // on `data` turns a partial response into a crash in whatever view mounted
  // the hook — the opposite of the fail-open contract above.
  const builtinToolpacks =
    usageResult.data?.tier?.entitlements?.builtinToolpacks;

  return useMemo(() => {
    const entitledSlugs: ReadonlySet<string> = builtinToolpacks
      ? new Set(builtinToolpacks)
      : ALL_BUILTIN_SLUGS;
    return {
      entitledSlugs,
      isEntitled: (pack: string) => isBuiltinPackEntitled(pack, entitledSlugs),
      isLoading: usageResult.isLoading,
    };
  }, [builtinToolpacks, usageResult.isLoading]);
}
