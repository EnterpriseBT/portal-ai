/**
 * Site-config deploy preflight (#319 slice 1).
 *
 * Runs before `Build site` in `deploy-static-site.yml`. The build fetches the
 * same endpoint and fails loud on a bad response — but that failure surfaces
 * as a raw thrown fetch, and you have to curl the API by hand to learn WHY
 * (no public tiers? a price unresolvable? API still rolling?). This turns each
 * of those into an actionable `::error::` naming the exact `portalops` command
 * for the environment, before the build burns its minutes.
 *
 * `evaluate` is pure and unit-tested (`__tests__/preflight-site-config.test.ts`).
 * The runner (fetch + bounded retry + `::error::` + exit) is smoke-gated — an
 * `aws`/network shell, no useful unit seam, same rationale as `verify-pages.mjs`.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/** Must match `ApiCode` in `apps/api/src/constants/api-codes.constants.ts`. */
const PRICE_UNRESOLVED = "SITE_CONFIG_PRICE_UNRESOLVED";

/**
 * Classify a site-config response.
 *
 * @param {{ status: number, body: unknown, isProd?: boolean, portalopsEnv: string }} args
 *   `status` is the HTTP status (0 for a transport failure); `body` is the
 *   parsed JSON envelope (or null when absent/unparseable).
 * @returns {{ ok: boolean, reason?: string, remediation?: string }}
 */
export function evaluate({ status, body, isProd = false, portalopsEnv }) {
  const prod = isProd ? " --confirm-prod" : "";

  if (status === 200) {
    const tiers = body?.payload?.tiers;
    if (Array.isArray(tiers) && tiers.length > 0) {
      return { ok: true };
    }
    if (Array.isArray(tiers)) {
      // 200 with a well-formed but empty tiers array — no public tiers.
      return {
        ok: false,
        reason: "the endpoint returned no public tiers",
        remediation: `portalops tier apply --env ${portalopsEnv} --yes${prod}`,
      };
    }
    // 200 but the envelope isn't the shape we expect — treat as unhealthy
    // rather than trusting a snapshot we can't read.
    return {
      ok: false,
      reason: "the endpoint returned 200 but no parseable tiers array",
    };
  }

  if (status === 503) {
    const code = body?.code;
    if (code === PRICE_UNRESOLVED) {
      const slug = String(body?.message ?? "").match(/tier '([^']+)'/)?.[1];
      return {
        ok: false,
        reason: `a public tier's Stripe price is unresolvable${
          slug ? ` (tier '${slug}')` : ""
        } (SITE_CONFIG_PRICE_UNRESOLVED)`,
        remediation: `ensure the Stripe price for tier '${
          slug ?? "<slug>"
        }' exists in the ${portalopsEnv} environment, then re-run \`portalops tier apply --env ${portalopsEnv} --yes${prod}\``,
      };
    }
    return {
      ok: false,
      reason: `the endpoint returned 503${code ? ` (${code})` : ""}`,
    };
  }

  // Transport (0), auth (401), or any other status — no remediation copy,
  // this is an availability problem the runner retries before giving up.
  return { ok: false, reason: `the endpoint returned ${status}` };
}

/** A transient class the runner retries: transport, auth mid-roll, or a
 *  gateway 5xx. A 503 is our own fail-closed — deterministic, never retried. */
function isRetryable(status) {
  return status === 0 || status === 401 || (status >= 500 && status !== 503);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce(url) {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* leave body null — evaluate treats a 200 with no body as unhealthy */
    }
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

async function run() {
  const url = process.env.SITE_CONFIG_URL;
  const portalopsEnv = process.env.PORTALOPS_ENV;
  const isProd = process.env.IS_PROD === "true";
  const retries = Number(process.env.PREFLIGHT_RETRIES ?? 5);
  const retryMs = Number(process.env.PREFLIGHT_RETRY_MS ?? 10_000);

  if (!url) {
    console.error("::error::preflight: SITE_CONFIG_URL is unset");
    process.exit(1);
  }

  let result;
  for (let attempt = 0; ; attempt++) {
    const { status, body } = await fetchOnce(url);
    result = evaluate({ status, body, isProd, portalopsEnv });
    if (result.ok) {
      console.log(`site-config preflight OK — ${url}`);
      return;
    }
    if (!isRetryable(status) || attempt >= retries) break;
    console.log(
      `preflight: endpoint not ready (status ${status}); retry ${
        attempt + 1
      }/${retries} in ${retryMs}ms`
    );
    await sleep(retryMs);
  }

  console.error(`::error::site-config preflight failed: ${result.reason}`);
  if (result.remediation) {
    console.error("Remediation — run against this environment:");
    for (const line of result.remediation.split("\n")) {
      console.error(`  ${line}`);
    }
  }
  process.exit(1);
}

/** Run only when invoked directly, so the module stays importable from tests
 *  without side effects (mirrors `generate-tokens.mjs`). */
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  await run();
}
