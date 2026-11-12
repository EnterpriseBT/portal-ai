/**
 * The one message every query-handle 404 carries (#796 adversarial F5).
 * A handle that is missing, expired, another org's, another user's, or a pin
 * the caller can no longer read must be indistinguishable: same status, same
 * code, same words. Two wordings told "exists but not yours" from "doesn't
 * exist".
 */
export const HANDLE_EXPIRED_MESSAGE =
  "Query handle has expired or does not exist";
