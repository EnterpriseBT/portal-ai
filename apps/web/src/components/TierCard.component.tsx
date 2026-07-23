import React from "react";

import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import {
  Button,
  Card,
  CardContent,
  Divider,
  Stack,
  Tooltip,
  Typography,
} from "@portalai/core/ui";

import {
  SUPPORT_MAILTO,
  formatAllocation,
  formatOverage,
  formatPeriod,
  formatPerToolCaps,
  formatPrice,
  entitlementPackNames,
} from "../utils/tier-format.util";

import type { BillingTier } from "@portalai/core/contracts";

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

export interface TierCardUIProps {
  /** The tier to render. */
  tier: BillingTier;
  /** Whether this tier is the org's current plan (drives the grid + CTA copy). */
  isCurrentPlan: boolean;
  /** Owner-only actions render disabled + tooltip for non-owners. */
  isOwner: boolean;
  /** True while a checkout session is being minted. */
  isPending: boolean;
  /** Invoked with the tier slug for a `subscribe` tier. */
  onSubscribe: (tierSlug: string) => void;
}

/**
 * One plan card (#241). Renders every policy dimension for a public tier or the
 * current plan; a `contact` (custom) tier shown only as an *upgrade teaser*
 * hides the grid and shows title + blurb + a "Contact support" link. The CTA is
 * driven entirely by `tier.cta` (the contract's single source of truth).
 */
export const TierCardUI: React.FC<TierCardUIProps> = ({
  tier,
  isCurrentPlan,
  isOwner,
  isPending,
  onSubscribe,
}) => {
  const { policy, cta } = tier;
  // A custom card hides its (negotiated) policy until the org is on it.
  const showGrid = cta !== "contact" || isCurrentPlan;

  const priceLine =
    cta === "subscribe"
      ? formatPrice(tier.price)
      : cta === "contact"
        ? "Custom pricing"
        : "Free";

  const rows = [
    { label: "Free tools", value: formatAllocation(policy.allocations.free) },
    {
      label: "Metered tools",
      value: formatAllocation(policy.allocations.metered),
    },
    {
      label: "Expensive tools",
      value: formatAllocation(policy.allocations.expensive),
    },
    { label: "Billing period", value: formatPeriod(policy.period) },
    { label: "When a limit is hit", value: formatOverage(policy.overage) },
    {
      label: "Custom toolpacks",
      value: policy.entitlements.customToolpacks ? "Allowed" : "Not allowed",
    },
  ];
  const caps = formatPerToolCaps(policy.perToolCaps);
  const packNames = entitlementPackNames(policy.entitlements.builtinToolpacks);

  return (
    <Card variant="outlined" sx={{ minWidth: 240 }}>
      <CardContent>
        <Stack spacing={1} alignItems="flex-start">
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h3" sx={{ fontSize: "1.1rem" }}>
              {tier.displayName}
            </Typography>
            {isCurrentPlan && (
              <Chip label="Current plan" size="small" color="primary" />
            )}
          </Stack>

          <Typography variant="body2" color="text.secondary">
            {priceLine}
          </Typography>

          {tier.description && (
            <Typography variant="body2">{tier.description}</Typography>
          )}

          {showGrid && (
            <>
              <Divider flexItem />
              {rows.map((r) => (
                <Typography
                  key={r.label}
                  variant="body2"
                  color="text.secondary"
                >
                  <strong>{r.label}:</strong> {r.value}
                </Typography>
              ))}
              <Typography variant="body2" color="text.secondary">
                <strong>Toolpacks:</strong>{" "}
                {packNames.length ? packNames.join(", ") : "None"}
              </Typography>
              {caps.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  <strong>Per-tool caps:</strong> {caps.join("; ")}
                </Typography>
              )}
            </>
          )}

          {cta === "subscribe" &&
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

          {cta === "contact" && (
            <Link href={SUPPORT_MAILTO} variant="body2">
              {isCurrentPlan
                ? "Contact support to manage/update your plan"
                : "Contact support"}
            </Link>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};
