/**
 * RebuildDispatchService (#311) — fires a GitHub `repository_dispatch` that
 * rebuilds the public marketing site when a fact it has baked into static
 * HTML changes.
 *
 * One of three triggers in the rebuild funnel:
 *   1. this service — Stripe `price.*` webhooks (amounts moved);
 *   2. `portalops` — a `vars set` of a `siteConfig` key or a `tier apply`
 *      with changes (operator-authored facts moved);
 *   3. the nightly schedule in `deploy-site-dev.yml` — the safety net.
 *
 * Because (3) exists, this service is **fire-and-forget and NEVER throws**.
 * It runs inside the Stripe webhook handler, where an exception would turn a
 * successfully-recorded event into a 500 and provoke a Stripe retry — a
 * stale marketing page for a few hours is categorically cheaper than broken
 * billing ingestion. Every failure path logs and returns.
 *
 * Double-firing is expected and harmless: a Stripe price change followed by
 * a `tier apply` fires twice. Rebuilds are idempotent and the workflow's
 * `concurrency` group serializes them.
 */

import { environment } from "../environment.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "rebuild-dispatch-service" });

/** The `repository_dispatch` event type the site workflows listen for. */
const DISPATCH_EVENT_TYPE = "site-config-changed";

export class RebuildDispatchService {
  /**
   * Ask GitHub Actions to rebuild + redeploy the public site.
   *
   * @param reason free-text provenance carried in `client_payload.reason`
   *   (e.g. `"stripe:price.updated"`) — it shows up in the workflow run so
   *   an operator can tell a price change from a nightly tick.
   */
  static async fireSiteRebuild(reason: string): Promise<void> {
    const token = environment.GITHUB_DISPATCH_TOKEN;
    if (!token) {
      // Expected in local dev and any env where the PAT was never minted.
      logger.debug(
        { reason },
        "Site-rebuild dispatch skipped — GITHUB_DISPATCH_TOKEN unset"
      );
      return;
    }

    const url = `https://api.github.com/repos/${environment.GITHUB_DISPATCH_REPO}/dispatches`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: DISPATCH_EVENT_TYPE,
          client_payload: { reason },
        }),
      });

      if (!response.ok) {
        // warn, not error: the nightly rebuild still covers this.
        logger.warn(
          {
            reason,
            status: response.status,
            body: await response.text().catch(() => "<unreadable>"),
          },
          "Site-rebuild dispatch rejected by GitHub"
        );
        return;
      }

      logger.info({ reason }, "Site-rebuild dispatch accepted");
    } catch (error) {
      logger.warn(
        { reason, error: error instanceof Error ? error.message : "Unknown" },
        "Site-rebuild dispatch failed to reach GitHub"
      );
    }
  }
}
