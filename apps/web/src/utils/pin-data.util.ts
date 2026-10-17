import type { ApiError } from "./api.util";

/**
 * #640: why a pin shows no data. Each is a state of the pin, not a failed
 * request, so the UI renders it in place of the block and never retries it.
 *
 * - `not-reexecutable`: the pin has no stored query (pinned before #640).
 * - `access-lost`: its definer can no longer reach the data. Only a caller
 *   who manages the pin is told this.
 * - `unavailable`: the same, as every other reader sees it — nothing about
 *   another user's access.
 */
export type PinDataRefusal = "not-reexecutable" | "access-lost" | "unavailable";

const REFUSALS: Record<string, PinDataRefusal> = {
  PORTAL_RESULT_NOT_REEXECUTABLE: "not-reexecutable",
  PORTAL_RESULT_DEFINER_ACCESS_LOST: "access-lost",
  PORTAL_RESULT_DATA_UNAVAILABLE: "unavailable",
};

export function pinDataRefusal(
  error: Pick<ApiError, "code"> | null | undefined
): PinDataRefusal | null {
  return (error?.code && REFUSALS[error.code]) || null;
}

export function isPinDataRefusal(
  error: Pick<ApiError, "code"> | null | undefined
): boolean {
  return pinDataRefusal(error) !== null;
}
