import { z } from "zod";

/**
 * Connector runtime-config contract (#580) — the wire shape of the
 * authenticated `GET /api/connector-config`, fetched by the SPA to configure
 * connector clients at runtime instead of at build time.
 *
 * Carries only **public, non-secret browser identifiers** (an OAuth client id,
 * a Google Picker *browser* API key, a Cloud project number) — the same values
 * the web bundle baked in via `VITE_GOOGLE_*` before, now served at runtime so
 * a prebuilt image can carry a self-hosted install's own (BYO) config. The
 * OAuth **client secret** is never here — it stays server-side. Schemas are
 * STRICT so a secret/internal field leaking in is a contract-test failure.
 */

/** Public Google connector client config (the picker + OAuth authorize URL). */
export const GoogleConnectorConfigSchema = z.strictObject({
  /** OAuth 2.0 **client id** (public). */
  clientId: z.string(),
  /** Google Picker **browser** API key (public; restricted in GCP by
   *  referrer + API, not by secrecy). */
  pickerApiKey: z.string(),
  /** GCP **project number**, the Picker `appId` (public). */
  cloudProjectNumber: z.string(),
});
export type GoogleConnectorConfig = z.infer<typeof GoogleConnectorConfigSchema>;

/**
 * The response payload. `google` is `null` when the install has no (complete)
 * Google config — a legitimately-absent optional connector, served fine; the
 * web's `isPickerConfigured` gate then disables the picker UI. Additive:
 * future connectors land as sibling nullable fields.
 */
export const ConnectorConfigResponseSchema = z.strictObject({
  google: GoogleConnectorConfigSchema.nullable(),
});
export type ConnectorConfigResponse = z.infer<
  typeof ConnectorConfigResponseSchema
>;
