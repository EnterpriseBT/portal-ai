/**
 * `JsonataSuggester` dep contract for the REST API connector's
 * transform-suggest route.
 *
 * Mirrors the column classifier's shape (`classifier.types.ts`): a
 * pure async interface so the route can be stubbed in tests with a
 * fake impl, plus a `JsonataSuggestError` class whose `reason`
 * discriminator drives telemetry (the route catches all reasons and
 * maps to ApiError(502, REST_API_TRANSFORM_SUGGEST_FAILED); reason
 * goes on the structured log line, not the response body).
 *
 * Truncation of `sampleResponse` happens upstream — the route walks
 * the sample through `truncateForPrompt` before invoking the
 * suggester, so this contract carries the already-truncated value.
 * The suggester is "dumb": it builds a prompt from its inputs, calls
 * the model, and returns the parsed result.
 */

/** Input to a single suggest call. */
export interface JsonataSuggesterInput {
  /** Pre-truncated sample. The suggester does not re-truncate. */
  sampleResponse: unknown;
  /** Optional natural-language hint from the user. */
  promptHint?: string;
  /**
   * Set on the route's retry attempt. Carries the prior model output
   * + the validation error `applyTransform` produced for it so the
   * prompt builder can render a "## Previous attempt" section and the
   * model can correct course.
   */
  previousAttempt?: { expression: string; error: string };
}

/** Output of a single suggest call. */
export interface JsonataSuggesterOutput {
  /** A JSONata expression as plain text. The route validates it
   *  against the full (untruncated) sample before returning to the
   *  client. */
  expression: string;
}

/**
 * The dep itself. Pure async — no per-call state retained inside the
 * suggester.
 */
export interface JsonataSuggester {
  suggest(input: JsonataSuggesterInput): Promise<JsonataSuggesterOutput>;
}

/**
 * Failure shape thrown by the default (Haiku-backed) implementation.
 * The route catches `JsonataSuggestError` regardless of `reason` and
 * maps to `ApiError(502, REST_API_TRANSFORM_SUGGEST_FAILED, …)`; the
 * `reason` is for telemetry, not branching logic in the route.
 */
export class JsonataSuggestError extends Error {
  override readonly name = "JsonataSuggestError" as const;
  readonly reason: JsonataSuggestErrorReason;

  constructor(
    reason: JsonataSuggestErrorReason,
    message: string,
    options?: ErrorOptions
  ) {
    super(`[jsonata-suggest:${reason}] ${message}`, options);
    this.reason = reason;
  }
}

export type JsonataSuggestErrorReason =
  | "malformed-response"
  | "timeout"
  | "network-error";
