/**
 * ConnectorConfigService (#580) — assembles the public connector client config
 * served by the authenticated `GET /api/connector-config`.
 *
 * Pure projection of server env — no DB, no external call, no cache needed
 * (env is read once at boot). Serves only public browser identifiers; the
 * OAuth client secret is never included. `google` is `null` unless ALL three
 * Google values are present — an incomplete config is a legitimately-absent
 * connector (the web's `isPickerConfigured` gate disables the picker), not an
 * error.
 */

import type {
  ConnectorConfigResponse,
  GoogleConnectorConfig,
} from "@portalai/core/contracts";

import { environment } from "../environment.js";

/** The env fields this service reads — injectable for tests. */
export interface ConnectorConfigEnv {
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_PICKER_API_KEY: string;
  GOOGLE_CLOUD_PROJECT_NUMBER: string;
}

export class ConnectorConfigService {
  static getConnectorConfig(
    env: ConnectorConfigEnv = environment
  ): ConnectorConfigResponse {
    return { google: ConnectorConfigService.resolveGoogle(env) };
  }

  private static resolveGoogle(
    env: ConnectorConfigEnv
  ): GoogleConnectorConfig | null {
    const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
    const pickerApiKey = env.GOOGLE_PICKER_API_KEY;
    const cloudProjectNumber = env.GOOGLE_CLOUD_PROJECT_NUMBER;
    if (!clientId || !pickerApiKey || !cloudProjectNumber) {
      return null;
    }
    return { clientId, pickerApiKey, cloudProjectNumber };
  }
}
