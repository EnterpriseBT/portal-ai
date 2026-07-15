import React from "react";

import Alert from "@mui/material/Alert";
import {
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  Tooltip,
  Typography,
} from "@portalai/core/ui";

import { sdk } from "../api/sdk";
import { DataResult } from "./DataResult.component";
import { FormAlert } from "./FormAlert.component";
import { toServerError, type ServerError } from "../utils/api.util";

import type { BillingTier } from "@portalai/core/contracts";

// ── Helpers ──────────────────────────────────────────────────────────

/** Present a tier slug as a human label, e.g. "enterprise-acme" → "Enterprise Acme". */
const formatTierSlug = (slug: string): string =>
  slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** "$49 / month" from a live price; "—" when display-degraded. */
const formatPrice = (price: BillingTier["price"]): string => {
  if (!price) return "—";
  const amount = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: price.currency.toUpperCase(),
    minimumFractionDigits: price.unitAmount % 100 === 0 ? 0 : 2,
  }).format(price.unitAmount / 100);
  return `${amount} / ${price.interval}`;
};

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
  /** The self-serve plan list (rendered only when unsubscribed). */
  tiers: BillingTier[];
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
  tiers,
  onSubscribe,
  onManage,
  isPending,
  serverError,
}) => (
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
          Plan changes, payment methods, invoices, and cancellation are handled
          in the secure Stripe billing portal.
        </Typography>
      </Box>
    )}

    {state === "unsubscribed" && (
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems="stretch"
      >
        {tiers.map((tier) => (
          <Card key={tier.slug} variant="outlined" sx={{ minWidth: 220 }}>
            <CardContent>
              <Stack spacing={1} alignItems="flex-start">
                <Typography variant="h3" sx={{ fontSize: "1.1rem" }}>
                  {tier.displayName}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {tier.purchasable ? formatPrice(tier.price) : "Free"}
                </Typography>
                {tier.purchasable &&
                  withOwnerGate(
                    isOwner,
                    <Button
                      type="button"
                      variant="contained"
                      disabled={!isOwner || isPending}
                      onClick={() => onSubscribe(tier.slug)}
                    >
                      {isPending ? "Redirecting…" : "Subscribe"}
                    </Button>
                  )}
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    )}
  </Stack>
);

// ── Container ────────────────────────────────────────────────────────

export const SubscriptionBilling: React.FC = () => {
  const organizationResult = sdk.organizations.current();
  const profileResult = sdk.auth.profile();
  const tiersResult = sdk.billing.tiers();

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

        // State derivation (spec D5): a live subscription wins; otherwise a
        // tier outside the selectable list means a managed custom plan.
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

        return (
          <SubscriptionBillingUI
            state={state}
            isOwner={
              profileResult.userId != null &&
              profileResult.userId === organization.ownerUserId
            }
            currentTierName={currentTierName}
            tiers={tiers}
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
