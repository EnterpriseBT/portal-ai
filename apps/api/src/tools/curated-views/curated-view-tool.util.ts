import { ZodError } from "zod";

import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "curated-view-tools" });

/** A refusal or failure, returned *as a tool result* so the agent relays it. */
export type ViewToolError = { error: { code: ApiCode; message: string } };

/**
 * #645: run a `CuratedViewService` call for a `view_management` tool, so every
 * outcome is a typed tool result the agent can relay, never a throw that ends
 * the turn:
 *
 * - **403** is re-thrown. The per-caller tool gate (`wrapWithPermissionGate`)
 *   turns it into `TOOL_PERMISSION_DENIED`, as for the rbac_management tools.
 * - **404** becomes `TOOL_TARGET_NOT_FOUND`: the view or entity doesn't exist
 *   for this caller (unreadable == absent), the same answer entity tools give.
 * - **Any other 4xx** keeps its own code (`CURATED_VIEW_DUPLICATE_KEY`,
 *   `CURATED_VIEW_FILTER_SQL_NOT_ENTITLED`, …) and message.
 * - **A 5xx or an unexpected error** becomes `failedCode` with a generic
 *   message, logged here; its text never reaches the model (#687 parity).
 */
export async function runViewTool<T>(
  failedCode: ApiCode,
  fn: () => Promise<T>
): Promise<T | ViewToolError> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 403) throw err;
      if (err.status === 404) {
        // The same result the permission gate's `targetNotFound` gives.
        return {
          error: { code: ApiCode.TOOL_TARGET_NOT_FOUND, message: err.message },
        };
      }
      if (err.status !== undefined && err.status < 500) {
        return { error: { code: err.code, message: err.message } };
      }
    }
    // Input the SDK's schema check let through but `validate` refused.
    if (err instanceof ZodError) {
      return {
        error: {
          code: ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
          message: err.issues[0]?.message ?? "Invalid input",
        },
      };
    }
    logger.error({ err }, "curated view tool failed");
    return {
      error: {
        code: failedCode,
        message: "The curated view operation failed.",
      },
    };
  }
}
