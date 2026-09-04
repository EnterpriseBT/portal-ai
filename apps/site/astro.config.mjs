// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

/**
 * Astro configuration (#311).
 *
 * `trailingSlash: "always"` + the default `build.format: "directory"` means
 * every route emits `<route>/index.html`, and the CloudFront Function in
 * `infra/cloudformation/site.yml` rewrites request URIs to match. Keeping
 * those two in agreement is what makes canonical URLs stable — a mismatch
 * shows up as duplicate-content penalties, not as a broken page.
 */
export default defineConfig({
  site: process.env.SITE_URL || "https://site-dev.portalsai.io",
  trailingSlash: "always",
  outDir: "dist",
  // `host: true` binds 0.0.0.0 instead of Astro's loopback default, which is
  // what makes the dev server reachable from the host browser through the
  // devcontainer's published port. Same reason `apps/web` sets it (#311).
  server: { port: 3002, host: true },
  // Every emitted route is indexable and belongs in the sitemap. If a page is
  // ever made `noindex` again, it must also be excluded from the sitemap here —
  // `verify-pages.mjs` asserts the two stay in agreement in both directions.
  integrations: [sitemap()],
  build: { format: "directory" },
});
