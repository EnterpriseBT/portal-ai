import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

/**
 * The parser's input errors: `interpret()` throws these, prefixed with their
 * code, when the request can't be interpreted (`detect-regions.ts`). They
 * explain what to change, so they are the caller's to read.
 */
const INPUT_ERROR = /^(UNSUPPORTED_LAYOUT_SHAPE|UNKNOWN_SHEET): /;

/**
 * #687: an interpret failure as an `ApiError`. A parser input error answers
 * 400 with its explanation; anything else (a model call, a bug) is a 500,
 * whose message the response scrubs and the log keeps.
 */
export function interpretFailure(err: unknown): ApiError {
  const message = err instanceof Error ? err.message : "Interpret failed";
  return new ApiError(
    INPUT_ERROR.test(message) ? 400 : 500,
    ApiCode.LAYOUT_PLAN_INTERPRET_FAILED,
    message
  );
}
