/**
 * Orchestrates the Google Sheets OAuth callback into a `ConnectorInstance`.
 *
 * - Verifies the signed `state` token.
 * - Exchanges the auth code for a refresh token.
 * - Fetches the authenticated user's email (used as the account identity).
 * - Find-or-update the per-(org, googleAccountEmail) ConnectorInstance.
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-A.plan.md` §Slice 8.
 */

import {
  EMPTY_ACCOUNT_INFO,
  type PublicAccountInfo,
} from "@portalai/core/contracts";

import { ApiCode } from "../constants/api-codes.constants.js";
import { ApiError } from "./http.service.js";
import { DbService } from "./db.service.js";
import {
  GoogleAuthError,
  GoogleAuthService,
} from "./google-auth.service.js";
import { googleSheetsAdapter } from "../adapters/google-sheets/google-sheets.adapter.js";
import { decryptCredentials } from "../utils/crypto.util.js";
import {
  OAuthStateError,
  verifyState,
} from "../utils/oauth-state.util.js";
import { SystemUtilities } from "../utils/system.util.js";

const GOOGLE_SHEETS_SLUG = "google-sheets";

export interface HandleCallbackInput {
  code: string;
  state: string;
}

export interface HandleCallbackResult {
  connectorInstanceId: string;
  accountInfo: PublicAccountInfo;
}

export class GoogleSheetsConnectorService {
  static async handleCallback(
    input: HandleCallbackInput
  ): Promise<HandleCallbackResult> {
    const { userId, organizationId } = verifyStateOrApiError(input.state);

    const tokens = await callExchangeOrApiError(input.code);
    const email = await callFetchEmailOrApiError(tokens.accessToken);

    const definition = await DbService.repository.connectorDefinitions.findBySlug(
      GOOGLE_SHEETS_SLUG
    );
    if (!definition) {
      throw new ApiError(
        500,
        ApiCode.GOOGLE_OAUTH_DEFINITION_NOT_FOUND,
        "google-sheets connector definition is not seeded"
      );
    }

    const credentials = {
      refresh_token: tokens.refreshToken,
      scopes: tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : [],
      googleAccountEmail: email,
    };

    const existing = await GoogleSheetsConnectorService.findByEmail(
      organizationId,
      definition.id,
      email
    );

    let connectorInstanceId: string;
    if (existing) {
      const updated = await DbService.repository.connectorInstances.update(
        existing.id,
        {
          credentials: credentials as unknown as string,
          updatedBy: userId,
        }
      );
      connectorInstanceId = updated?.id ?? existing.id;
    } else {
      const created = await DbService.repository.connectorInstances.create({
        id: SystemUtilities.id.v4.generate(),
        organizationId,
        connectorDefinitionId: definition.id,
        name: `Google Sheets (${email})`,
        status: "pending",
        config: null,
        credentials: credentials as unknown as string,
        lastSyncAt: null,
        lastErrorMessage: null,
        enabledCapabilityFlags: null,
        created: Date.now(),
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });
      connectorInstanceId = created.id;
    }

    const accountInfo =
      googleSheetsAdapter.toPublicAccountInfo?.(credentials) ??
      EMPTY_ACCOUNT_INFO;

    return { connectorInstanceId, accountInfo };
  }

  /**
   * Linear scan over the org's google-sheets instances; decrypts each
   * credentials blob to match by email. O(N) — acceptable for v1 (one
   * human, 1–3 Google accounts). Promote to a dedicated repository
   * method when N becomes meaningful.
   */
  private static async findByEmail(
    organizationId: string,
    connectorDefinitionId: string,
    email: string
  ) {
    const instances =
      await DbService.repository.connectorInstances.findByOrgAndDefinition(
        organizationId,
        connectorDefinitionId
      );
    for (const instance of instances) {
      if (
        typeof instance.credentials === "object" &&
        instance.credentials !== null &&
        (instance.credentials as Record<string, unknown>).googleAccountEmail ===
          email
      ) {
        return instance;
      }
      // The repository's `findByOrgAndDefinition` already decrypts, so the
      // string-credentials branch shouldn't normally fire. Keep a fallback
      // for defensive coverage and to match other repository code paths.
      if (typeof instance.credentials === "string") {
        try {
          const decoded = decryptCredentials(instance.credentials);
          if (decoded.googleAccountEmail === email) return instance;
        } catch {
          /* skip rows with un-decryptable credentials */
        }
      }
    }
    return undefined;
  }
}

function verifyStateOrApiError(token: string): {
  userId: string;
  organizationId: string;
} {
  try {
    return verifyState(token);
  } catch (err) {
    if (err instanceof OAuthStateError) {
      throw new ApiError(
        400,
        ApiCode.GOOGLE_OAUTH_INVALID_STATE,
        `OAuth state ${err.kind}`
      );
    }
    throw err;
  }
}

async function callExchangeOrApiError(code: string) {
  try {
    return await GoogleAuthService.exchangeCode({ code });
  } catch (err) {
    if (err instanceof GoogleAuthError || (err as Error).name === "GoogleAuthError") {
      throw new ApiError(
        502,
        ApiCode.GOOGLE_OAUTH_EXCHANGE_FAILED,
        err instanceof Error ? err.message : "exchange failed"
      );
    }
    throw err;
  }
}

async function callFetchEmailOrApiError(accessToken: string): Promise<string> {
  try {
    return await GoogleAuthService.fetchUserEmail(accessToken);
  } catch (err) {
    if (err instanceof GoogleAuthError || (err as Error).name === "GoogleAuthError") {
      throw new ApiError(
        502,
        ApiCode.GOOGLE_OAUTH_USERINFO_FAILED,
        err instanceof Error ? err.message : "userinfo failed"
      );
    }
    throw err;
  }
}
