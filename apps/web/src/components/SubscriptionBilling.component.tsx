import React from "react";

import Alert from "@mui/material/Alert";
import { Box, Button, Stack, Tooltip, Typography } from "@portalai/core/ui";

import { sdk } from "../api/sdk";
import { DataResult } from "./DataResult.component";
import { FormAlert } from "./FormAlert.component";
import { TierCardUI } from "./TierCard.component";
import { toServerError, type ServerError } from "../utils/api.util";

import type {
  BillingTier,
  OrganizationUsageGetResponse,
} from "@portalai/core/contracts";

// ── Helpers ──────────────────────────────────────────────────────────

/** Column counts by breakpoint — fills the container, capped at 4 (#241). */
const CARD_GRID_COLUMNS = {
  xs: "1fr",
  sm: "repeat(2, minmax(0, 1fr))",
  md: "repeat(3, minmax(0, 1fr))",
  lg: "repeat(4, minmax(0, 1fr))",
} as const;

/** Present a tier slug as a human label, e.g. "enterprise-acme" → "Enterprise Acme". */
const formatTierSlug = (slug: string): string =>
  slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** A read-only current-plan card for a tier that isn't in the billing list
 *  (a managed, unlisted bespoke tier): synthesize a `BillingTier` from the
 *  org's resolved `TierPolicy` (#257). A `TierPolicy` carries no price/blurb,
 *  and `cta: "none"` means the card renders no action (Manage owns changes). */
const synthesizeCurrentPlanTier = (
  policy: OrganizationUsageGetResponse["tier"],
  displayName: string
): BillingTier => ({
  slug: policy.tier,
  displayName,
  policy,
  description: null,
  cta: "none",
  price: null,
});

const OWNER_ONLY_TOOLTIP = "Only the organization owner can manage billing";

/** Wrap a disabled action in the owner-only tooltip (the `span` keeps the
 *  tooltip firing on a disabled MUI button). Plain function, not a component. */
const withOwnerGate = (
  isOwner: boolean,
  action: React.ReactElement
): React.ReactElement =>
  isOwner ? (
    action
  ) : (
    <Tooltip title={OWNER_ONLY_TOOLTIP}>
      <span>{action}</span>
    </Tooltip>
  );

// ── Pure UI ──────────────────────────────────────────────────────────

export type SubscriptionBillingState =
  | "unsubscribed"
  | "subscribed"
  | "managed";

export interface SubscriptionBillingUIProps {
  /** Which of the tab's states to render (derived by the container). */
  state: SubscriptionBillingState;
  /** Owner-only actions render disabled + tooltip for non-owners. */
  isOwner: boolean;
  /** Human label of the org's current plan. */
  currentTierName: string;
  /** The org's current plan slug — flags the matching card. */
  currentTierSlug: string;
  /** The self-serve plan list (rendered only when unsubscribed). */
  tiers: BillingTier[];
  /** The org's current plan as a card, shown read-only in the subscribed +
   *  managed states (#257). Null while unresolved → card omitted (degrade). */
  currentPlanTier: BillingTier | null;
  onSubscribe: (tierSlug: string) => void;
  onManage: () => void;
  /** True while a checkout/portal session is being minted. */
  isPending: boolean;
  serverError: ServerError | null;
}

export const SubscriptionBillingUI: React.FC<SubscriptionBillingUIProps> = ({
  state,
  isOwner,
  currentTierName,
  currentTierSlug,
  tiers,
  currentPlanTier,
  onSubscribe,
  onManage,
  isPending,
  serverError,
}) => {
  // On a custom plan (a `contact` tier is the org's current plan), show ONLY
  // that card — a custom-plan customer doesn't self-serve to the other tiers.
  // Otherwise show the full list to encourage upgrades (#241).
  const currentTier = tiers.find((t) => t.slug === currentTierSlug);
  const displayTiers = currentTier?.cta === "contact" ? [currentTier] : tiers;

  return (
    <Stack spacing={2}>
      <FormAlert serverError={serverError} />

      <Typography variant="body1">
        Current plan: <strong>{currentTierName}</strong>
      </Typography>

      {state === "managed" && (
        <Alert severity="info">
          Your plan is managed — contact us to make changes.
        </Alert>
      )}

      {/* #257: the current plan's policy, read-only, in both non-list states.
          Above Manage (subscribed) / below the banner (managed). */}
      {(state === "subscribed" || state === "managed") && currentPlanTier && (
        <Box sx={{ maxWidth: 360 }}>
          <TierCardUI
            tier={currentPlanTier}
            isCurrentPlan
            isOwner={isOwner}
            isPending={isPending}
            onSubscribe={onSubscribe}
          />
        </Box>
      )}

      {state === "subscribed" && (
        <Box>
          {withOwnerGate(
            isOwner,
            <Button
              type="button"
              variant="contained"
              disabled={!isOwner || isPending}
              onClick={onManage}
            >
              {isPending ? "Opening…" : "Manage subscription"}
            </Button>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Plan changes, payment methods, invoices, and cancellation are
            handled in the secure Stripe billing portal.
          </Typography>
        </Box>
      )}

      {state === "unsubscribed" && (
        <Stack spacing={1}>
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: CARD_GRID_COLUMNS,
              alignItems: "stretch",
            }}
          >
            {displayTiers.map((tier) => (
              <TierCardUI
                key={tier.slug}
                tier={tier}
                isCurrentPlan={tier.slug === currentTierSlug}
                isOwner={isOwner}
                isPending={isPending}
                onSubscribe={onSubscribe}
              />
            ))}
          </Box>
          {/* #217: display-only — Stripe Tax computes the actual amount at
            checkout from the billing address. */}
          <Typography variant="caption" color="text.secondary">
            Prices exclude tax, which is calculated at checkout.
          </Typography>
        </Stack>
      )}
    </Stack>
  );
};

// ── Container ────────────────────────────────────────────────────────

export const SubscriptionBilling: React.FC = () => {
  const organizationResult = sdk.organizations.current();
  const profileResult = sdk.auth.profile();
  const tiersResult = sdk.billing.tiers();
  // #257: source the current tier's policy. Deliberately NOT in the DataResult
  // below — a usage hiccup must not blank the whole tab; the current-plan card
  // just degrades to omitted.
  const usageResult = sdk.organizations.usage();

  const checkoutMutation = sdk.billing.checkout();
  const portalMutation = sdk.billing.portal();

  // Redirect to the Stripe-hosted page; the mutation's `error` state is
  // surfaced through FormAlert, so a rejected mutate is swallowed here.
  const handleSubscribe = (tierSlug: string) => {
    checkoutMutation
      .mutateAsync({ tier: tierSlug })
      .then(({ url }) => window.location.replace(url))
      .catch(() => undefined);
  };
  const handleManage = () => {
    portalMutation
      .mutateAsync()
      .then(({ url }) => window.location.replace(url))
      .catch(() => undefined);
  };

  return (
    <DataResult results={{ organizationResult, profileResult, tiersResult }}>
      {({ organizationResult, profileResult, tiersResult }) => {
        const { organization } = organizationResult;
        const { tiers } = tiersResult;

        // State derivation (spec D5/#241 D6): a live subscription wins;
        // otherwise a current tier absent from the org-scoped list is a
        // managed custom plan (the fallback banner). A listed custom tier the
        // org is on renders as its own current-plan card, not "managed".
        const subscribed = organization.stripeSubscriptionId != null;
        const managed =
          !subscribed && !tiers.some((t) => t.slug === organization.tier);
        const state: SubscriptionBillingState = subscribed
          ? "subscribed"
          : managed
            ? "managed"
            : "unsubscribed";

        const currentTierName =
          tiers.find((t) => t.slug === organization.tier)?.displayName ??
          formatTierSlug(organization.tier);

        // #257: the current plan as a card — the listed BillingTier when it's
        // selectable (subscribed), else synthesized from the resolved
        // TierPolicy on usage() (managed/unlisted). Null while usage is
        // unresolved → the card is omitted.
        const currentPolicy = usageResult.data?.tier;
        const currentPlanTier: BillingTier | null =
          tiers.find((t) => t.slug === organization.tier) ??
          (currentPolicy
            ? synthesizeCurrentPlanTier(currentPolicy, currentTierName)
            : null);

        return (
          <SubscriptionBillingUI
            state={state}
            isOwner={
              profileResult.userId != null &&
              profileResult.userId === organization.ownerUserId
            }
            currentTierName={currentTierName}
            currentTierSlug={organization.tier}
            tiers={tiers}
            currentPlanTier={currentPlanTier}
            onSubscribe={handleSubscribe}
            onManage={handleManage}
            isPending={checkoutMutation.isPending || portalMutation.isPending}
            serverError={toServerError(
              checkoutMutation.error ?? portalMutation.error
            )}
          />
        );
      }}
    </DataResult>
  );
};
