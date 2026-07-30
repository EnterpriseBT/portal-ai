import React from "react";

import { Link } from "@tanstack/react-router";
import MuiLink from "@mui/material/Link";

import { SettingsTab } from "../utils/routes.util";
import { UPGRADE_CTA_LABEL } from "../utils/tool-packs.util";

export interface UpgradeLinkProps {
  /** Overrides the shared CTA label. Rarely needed — prefer the default. */
  label?: string;
  variant?: "body2" | "caption" | "inherit";
}

/**
 * The single upgrade destination for every entitlement affordance (#284):
 * Settings → Subscription & Billing, deep-linked so the user lands on the
 * tab that answers "which plan do I need".
 *
 * Copy is deliberately role-agnostic — the owner-only gate already lives on
 * the billing tab itself, so nothing here reads the org owner id.
 *
 * Shape notes, both load-bearing:
 * - The router `Link` is the anchor and `MuiLink component="span"` supplies
 *   only the visual treatment. The usual `MuiLink component={Link}` cannot be
 *   used here: MUI's `component` prop erases TanStack's router generic, so
 *   `search` collapses to `never` and no typed search param can be passed.
 * - `to` is the literal `"/settings"`, not `ApplicationRoute.Settings`. An
 *   enum member type defeats TanStack's route lookup for search-param
 *   inference (plain `to` still works with the enum — typed `search` does not).
 */
export const UpgradeLink: React.FC<UpgradeLinkProps> = ({
  label = UPGRADE_CTA_LABEL,
  variant = "body2",
}) => (
  <Link
    to="/settings"
    search={{ tab: SettingsTab.Billing }}
    style={{ textDecoration: "none" }}
  >
    <MuiLink component="span" variant={variant} sx={{ cursor: "pointer" }}>
      {label}
    </MuiLink>
  </Link>
);
