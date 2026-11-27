/**
 * #1079: the start box opens the portal it created carrying its first
 * question's outcome in history state, which the portal page reads once and
 * then drops, so Back and Forward don't act on it again:
 * - admitted (`pendingInitialMessage`): the page opens the stream that
 *   answers it. Only this turn is resumed: a portal whose newest message is
 *   an older, failed turn isn't re-run on every visit (#1137 code review),
 *   since the stream route doesn't re-admit a turn against the ceiling;
 * - refused (`refusedInitialMessage`): the page puts the question back in
 *   the composer and shows the turn-limit notice.
 */

export interface RefusedInitialMessage {
  /** The question as the user typed it. */
  prompt: string;
  /** The ceiling's refusal, the same words the send route answers with. */
  message: string;
}

declare module "@tanstack/react-router" {
  interface HistoryState {
    refusedInitialMessage?: RefusedInitialMessage;
    pendingInitialMessage?: true;
  }
}

/**
 * The refused question in `state`, or null. History state outlives the code
 * that wrote it (a reload, a restored session), so anything not shaped like
 * one reads as none.
 */
export const readRefusedInitialMessage = (
  state: unknown
): RefusedInitialMessage | null => {
  if (typeof state !== "object" || state === null) return null;
  const value = (state as { refusedInitialMessage?: unknown })
    .refusedInitialMessage;
  if (typeof value !== "object" || value === null) return null;
  const { prompt, message } = value as Record<string, unknown>;
  if (typeof prompt !== "string" || prompt.trim() === "") return null;
  if (typeof message !== "string") return null;
  return { prompt, message };
};

/** Whether `state` says the portal's first question was admitted and waits
 *  for its answer. */
export const readPendingInitialMessage = (state: unknown): boolean =>
  typeof state === "object" &&
  state !== null &&
  (state as { pendingInitialMessage?: unknown }).pendingInitialMessage === true;
