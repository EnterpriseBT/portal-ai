import { z } from "zod";

import { emailField } from "./text-limits.contract.js";

/**
 * "Sign in with SSO" discovery contract (#916): the wire shape of the
 * anonymous `POST /api/public/sso-discovery`. The web sends a work email; the
 * API answers the Auth0 enterprise connection its domain signs in through,
 * or null. The email travels in a body so it never lands in a URL or an
 * access log. Strict, so an unknown key is a 400 rather than dropped.
 */
export const SsoDiscoveryRequestBodySchema = z
  .object({
    email: emailField(),
  })
  .strict();
export type SsoDiscoveryRequestBody = z.infer<
  typeof SsoDiscoveryRequestBodySchema
>;

/** Only a connection name (or null); never user, org or tenant data. */
export const SsoDiscoveryResponseSchema = z.strictObject({
  connection: z.string().nullable(),
});
export type SsoDiscoveryResponse = z.infer<typeof SsoDiscoveryResponseSchema>;
