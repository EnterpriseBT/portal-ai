/**
 * Decrypt + Zod-parse `connectorInstances.credentials` for the REST API
 * adapter.
 *
 * The connector-instances repository normally pre-decrypts the
 * `credentials` column to `Record<string, unknown> | null` before the
 * adapter sees the instance. This util handles both shapes — already
 * decrypted (object) and still-encrypted (string) — so the adapter
 * doesn't have to care which read path delivered the instance.
 *
 * Returns `null` when credentials are absent or empty (the caller
 * decides whether that's an error for the configured auth mode).
 * Throws `ApiError(REST_API_AUTH_FAILED)` when:
 *   - the encrypted blob can't be decrypted, or
 *   - the decrypted payload doesn't satisfy `ApiCredentialsSchema`.
 */
import {
  ApiCredentialsSchema,
  type ApiCredentials,
  type ConnectorInstance,
} from "@portalai/core/models";

import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";
import { decryptCredentials } from "../../utils/crypto.util.js";

export function loadCredentials(
  instance: ConnectorInstance
): ApiCredentials | null {
  const raw = instance.credentials as
    | string
    | Record<string, unknown>
    | null
    | undefined;
  if (raw === null || raw === undefined) return null;

  let decoded: Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      decoded = decryptCredentials(raw);
    } catch (err) {
      throw new ApiError(
        500,
        ApiCode.REST_API_AUTH_FAILED,
        `Failed to decrypt credentials for instance ${instance.id}`,
        { connectorInstanceId: instance.id, cause: (err as Error).message }
      );
    }
  } else {
    decoded = raw;
  }

  if (Object.keys(decoded).length === 0) return null;

  const parsed = ApiCredentialsSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ApiError(
      500,
      ApiCode.REST_API_AUTH_FAILED,
      `Credentials for instance ${instance.id} failed schema validation`,
      {
        connectorInstanceId: instance.id,
        issues: parsed.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      }
    );
  }
  return parsed.data;
}
