/**
 * `@portalai/core/content` (#311) — the product's canonical user-facing
 * vocabulary, shared by the authenticated app's Help view and the public
 * marketing site.
 *
 * Everything here is **pure data**, importing nothing but sibling content
 * modules (#1049), deliberately: the marketing site consumes it at build time
 * from a static-site generator, so anything that reached for a router, a
 * bundler alias, or a browser global would break the build rather than
 * degrade.
 */

export * from "./glossary.util.js";
export * from "./faq.util.js";
export * from "./help-url.util.js";
export * from "./help-search.util.js";
export * from "./station-attachments.util.js";
export * from "./subprocessors.util.js";
export * from "./troubleshooting.util.js";
