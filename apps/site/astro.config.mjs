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
  integrations: [
    sitemap({
      // Keep the sitemap and the pages' own robots meta telling the same
      // story. The legal pages are `noindex` while their copy is a draft,
      // and listing a noindex URL in the sitemap is a contradictory signal
      // ("don't index this" / "here, index this"). `verify-pages.mjs`
      // asserts the two stay in agreement.
      filter: (page) => !/\/(privacy|terms)\/$/.test(page),
    }),
  ],
  build: { format: "directory" },
});
