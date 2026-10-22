/**
 * `/.well-known/security.txt` (#613, RFC 9116) — prerendered at build time
 * like every page, so the contact is the SSM-sourced SECURITY_EMAIL and
 * `Expires` is measured from this build. `verify-pages.mjs` validates the
 * emitted file.
 */
import type { APIRoute } from "astro";

import { securityEmail, siteUrl } from "../../lib/site-context.js";
import { renderSecurityTxt } from "../../lib/security-txt.js";

export const GET: APIRoute = () =>
  new Response(
    renderSecurityTxt({
      contactEmail: securityEmail,
      siteUrl,
      now: new Date(),
    }),
    { headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
