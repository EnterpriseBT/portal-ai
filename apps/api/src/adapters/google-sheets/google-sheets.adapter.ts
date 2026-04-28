/**
 * Google Sheets connector adapter.
 *
 * Phase A only implements `toPublicAccountInfo` so the redaction
 * serializer can surface `googleAccountEmail` on connector-instance
 * responses. Sync, query, and discovery methods land in Phases B/D.
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-A.plan.md` §Slice 9.
 */

import type { ConnectorAdapter } from "../adapter.interface.js";
import {
  EMPTY_ACCOUNT_INFO,
  type PublicAccountInfo,
} from "@portalai/core/contracts";

function notImplemented(method: string): never {
  throw new Error(
    `googleSheetsAdapter.${method} is not implemented yet (Phase D)`
  );
}

export const googleSheetsAdapter: ConnectorAdapter = {
  toPublicAccountInfo(
    credentials: Record<string, unknown> | null
  ): PublicAccountInfo {
    if (!credentials) return EMPTY_ACCOUNT_INFO;
    const email = credentials.googleAccountEmail;
    if (typeof email !== "string" || email.length === 0) {
      return EMPTY_ACCOUNT_INFO;
    }
    return { identity: email, metadata: {} };
  },

  async queryRows() {
    return notImplemented("queryRows");
  },
  async syncEntity() {
    return notImplemented("syncEntity");
  },
  async discoverEntities() {
    return notImplemented("discoverEntities");
  },
  async discoverColumns() {
    return notImplemented("discoverColumns");
  },
};
