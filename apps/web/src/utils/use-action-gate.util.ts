import { useCallback } from "react";

import { useNavigate } from "@tanstack/react-router";

import type { TierEntitlements } from "@portalai/core/models";
import type { ActionGate } from "@portalai/core/ui";

import { sdk } from "../api/sdk";
import { decideActionGate, type ActionGateInput } from "./action-gate.util";
import { SettingsTab } from "./routes.util";

/** The tier entitlements that gate an action (the boolean ones). */
export type EntitlementKey = {
  [K in keyof TierEntitlements]: TierEntitlements[K] extends boolean
    ? K
    : never;
}[keyof TierEntitlements];

export interface UseActionGateResult {
  /** `decideActionGate`, with upsells sent to Settings → Billing. */
  gate(input: Omit<ActionGateInput, "onUpgrade">): ActionGate;
  /** Whether the org's plan includes it. Fails closed while unknown. */
  entitled(key: EntitlementKey): boolean;
}

/**
 * #688: the web's action-gate decider, wired to the tier policy
 * (`GET /api/organization/usage`, the cache entry Settings and Toolpacks
 * already hold) and the upgrade destination `UpgradeLink` uses.
 *
 * `entitled` **fails closed** (`?? false`): it gates actions, and the server
 * (the real gate) would refuse them anyway.
 */
export function useActionGate(): UseActionGateResult {
  const usage = sdk.organizations.usage();
  const navigate = useNavigate();
  const entitlements = usage.data?.tier?.entitlements;

  const onUpgrade = useCallback(() => {
    void navigate({ to: "/settings", search: { tab: SettingsTab.Billing } });
  }, [navigate]);

  const entitled = useCallback(
    (key: EntitlementKey) => entitlements?.[key] ?? false,
    [entitlements]
  );

  const gate = useCallback(
    (input: Omit<ActionGateInput, "onUpgrade">) =>
      decideActionGate({ ...input, onUpgrade }),
    [onUpgrade]
  );

  return { gate, entitled };
}
