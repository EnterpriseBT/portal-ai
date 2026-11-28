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

/**
 * #1137 adversarial walk: an admitted first question whose portal never
 * opened (Back pressed while the create was in flight) would otherwise sit
 * unanswered, with its turn counted. The launcher marks the portal in this
 * tab's session storage from the create's promise, so the mark lands even
 * after the caller has left, and the portal page answers it on its next
 * visit. The page forgets the mark when it reads it, so a turn is resumed at
 * most once, as with the history state. Storage that can't be read or
 * written means no marks: the question then waits, as before.
 */
const PENDING_FIRST_TURNS_KEY = "portalai-pending-first-turns";

/** A mark older than this is dropped: the portal was never opened. */
export const PENDING_FIRST_TURN_TTL_MS = 24 * 60 * 60 * 1000;

const readMarks = (): Record<string, number> => {
  try {
    const raw = sessionStorage.getItem(PENDING_FIRST_TURNS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number"
      )
    );
  } catch {
    return {};
  }
};

const writeMarks = (marks: Record<string, number>) => {
  try {
    if (Object.keys(marks).length === 0) {
      sessionStorage.removeItem(PENDING_FIRST_TURNS_KEY);
    } else {
      sessionStorage.setItem(PENDING_FIRST_TURNS_KEY, JSON.stringify(marks));
    }
  } catch {
    // Unavailable storage: no mark, and nothing else breaks.
  }
};

const liveMarks = (now: number): Record<string, number> =>
  Object.fromEntries(
    Object.entries(readMarks()).filter(
      ([, at]) => now - at < PENDING_FIRST_TURN_TTL_MS
    )
  );

/** Marks `portalId`'s first question as admitted and not yet answered. */
export const rememberPendingFirstTurn = (
  portalId: string,
  now: number = Date.now()
): void => writeMarks({ ...liveMarks(now), [portalId]: now });

/** Whether `portalId` has an unexpired mark. */
export const hasPendingFirstTurn = (
  portalId: string,
  now: number = Date.now()
): boolean => portalId in liveMarks(now);

/** Drops `portalId`'s mark. */
export const forgetPendingFirstTurn = (portalId: string): void => {
  const marks = readMarks();
  if (!(portalId in marks)) return;
  delete marks[portalId];
  writeMarks(marks);
};
