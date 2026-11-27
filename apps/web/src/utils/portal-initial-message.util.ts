/**
 * #1079: a portal started with a question the agent-turn ceiling refused is
 * still created, and the start box opens it carrying the question in history
 * state. The portal page puts it back in the composer, shows the turn-limit
 * notice, then drops the state so Back and Forward don't bring it back.
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
