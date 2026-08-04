/**
 * The one build-time context every page reads (#311).
 *
 * ES modules are evaluated once per build, so the top-level await below runs
 * exactly once no matter how many pages import it. That is the mechanism
 * behind the atomic-snapshot guarantee: every page renders from the SAME
 * `tiers`/`contact` object, so the pricing page and the home page cannot
 * disagree about what Pro costs.
 */

import { fetchSiteConfig, type SiteConfigResult } from "./site-config.js";

const result: SiteConfigResult = await fetchSiteConfig();

export const siteConfig = result.config;
export const isFixtureBuild = result.isFixture;

/** Commit the site was built from — CI provides it; local builds say so. */
const commit = (
  process.env.GITHUB_SHA ||
  process.env.BUILD_SHA ||
  "local"
).slice(0, 12);

/**
 * `<meta name="portal:build">` — the provenance stamp. Carries the commit
 * and the snapshot's `generatedAt`, so a stale published price can be traced
 * to a specific build and a specific config read.
 *
 * A fixture build stamps `fixture` in place of the timestamp; the deploy
 * workflow greps for it and refuses to publish, which is why the word has to
 * appear verbatim.
 */
export const buildStamp = `${commit} ${
  isFixtureBuild ? "fixture" : siteConfig.generatedAt
}`;

/**
 * Where the "sign up" / sign-in / pricing CTAs point — the web app that
 * matches this site's environment. Every real deploy sets `SITE_APP_URL`
 * explicitly (see `deploy-site-dev.yml` → app-dev, prod → prod). Only local
 * dev falls through, and it must land on the local app, not app-dev — so
 * `astro dev` defaults to `localhost:3000` and a built (deployed) site keeps
 * the app-dev default for any env that forgot to set the var.
 */
export const appUrl =
  process.env.SITE_APP_URL ||
  (import.meta.env.DEV
    ? "http://localhost:3000"
    : "https://app-dev.portalsai.io");

/** Canonical origin — mirrors `astro.config.mjs`'s `site`. */
export const siteUrl = process.env.SITE_URL || "https://site-dev.portalsai.io";
