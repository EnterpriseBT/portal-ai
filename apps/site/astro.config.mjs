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
  integrations: [sitemap()],
  build: { format: "directory" },
});
