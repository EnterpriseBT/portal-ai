import { z, ZodError } from "zod";

import { TagTargetTypeSchema } from "@portalai/core/models";

import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "tag-tools" });

/** #1071: one taggable object, named by its type and id. */
export const TagTargetInputSchema = z
  .object({
    type: TagTargetTypeSchema.describe(
      "The object's type: entity, station, pin (a pinned result), connector_instance or curated_view"
    ),
    id: z.string().min(1).describe("The object's id"),
  })
  .strict();

/** A refusal or failure, returned *as a tool result* so the agent relays it. */
export type TagToolError = { error: { code: ApiCode; message: string } };

/**
 * #1071: run a tag service call for a `tag_management` tool, so every outcome
 * is a typed tool result the agent can relay, never a throw that ends the
 * turn. The same mapping as the view_management tools (`runViewTool`):
 *
 * - **A 403** is re-thrown. The per-caller tool gate
 *   (`wrapWithPermissionGate`) turns it into `TOOL_PERMISSION_DENIED`.
 * - **A 404** becomes `TOOL_TARGET_NOT_FOUND`: the tag or object doesn't
 *   exist for this caller (unreadable == absent).
 * - **Any other 4xx** keeps its own code and message
 *   (`ENTITY_TAG_DUPLICATE_NAME`, …).
 * - **A 5xx or an unexpected error** becomes `failedCode` with a generic
 *   message, logged here; its text never reaches the model (#687 parity).
 */
export async function runTagTool<T>(
  failedCode: ApiCode,
  fn: () => Promise<T>
): Promise<T | TagToolError> {
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
    // `validate` refused the input. The AI SDK checks the same schema before
    // execute runs (#846), so on the agent path this is defence in depth.
    if (err instanceof ZodError) {
      return {
        error: {
          code: ApiCode.ENTITY_TAG_INVALID_PAYLOAD,
          message: err.issues[0]?.message ?? "Invalid input",
        },
      };
    }
    logger.error({ err }, "tag tool failed");
    return {
      error: { code: failedCode, message: "The tag operation failed." },
    };
  }
}
