/**
 * Site-rebuild dispatch (#311) — the operator-side arm of the rebuild triad
 * (the API's Stripe `price.*` webhook and the nightly schedule are the other
 * two).
 *
 * Fired after an operator changes a fact the public marketing site has baked
 * into static HTML: a `vars set` of a `siteConfig` catalog key, or a
 * `tier apply` that actually changed rows.
 *
 * **It never blocks the write.** By the time this runs, the value is already
 * committed to SSM/Secrets Manager or Postgres. A missing token or a GitHub
 * outage is a notice on stderr and a clean return — exiting non-zero here
 * would tell the operator (or an agent branching on the exit code) that a
 * write which actually succeeded had failed. The nightly rebuild is the
 * safety net for anything this misses.
 *
 * Auth is the OPERATOR's shell `GITHUB_TOKEN` — the same credential `gh`
 * uses — not a managed catalog secret. The API's server-side dispatch has
 * its own `GITHUB_DISPATCH_TOKEN`; these are deliberately separate identities.
 */

/** The `repository_dispatch` event type the site workflows listen for. */
const DISPATCH_EVENT_TYPE = "site-config-changed";

/** The repo whose Actions host the site deploy workflows. */
const DISPATCH_REPO =
  process.env.GITHUB_DISPATCH_REPO || "EnterpriseBT/portal-ai";

const notice = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

/**
 * Ask GitHub Actions to rebuild + redeploy the public site.
 *
 * @param reason provenance carried in `client_payload.reason`, surfaced in
 *   the workflow run (e.g. `"vars set SUPPORT_EMAIL (app-dev)"`).
 */
export async function fireSiteRebuild(reason: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    notice(
      "note: site rebuild not requested (GITHUB_TOKEN unset). " +
        "The nightly scheduled rebuild will pick this change up."
    );
    return;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${DISPATCH_REPO}/dispatches`,
      {
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
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      notice(
        `warning: site rebuild not requested — GitHub returned ${response.status}` +
          `${body ? ` (${body.trim()})` : ""}. The change is saved; the ` +
          "nightly rebuild will publish it."
      );
      return;
    }

    notice(`site rebuild requested (${reason}).`);
  } catch (error) {
    notice(
      "warning: site rebuild could not be requested — " +
        `${error instanceof Error ? error.message : String(error)}. ` +
        "The change is saved; the nightly rebuild will publish it."
    );
  }
}
