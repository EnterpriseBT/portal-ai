import React from "react";

/**
 * How long a list waits after the user's last change before it speaks
 * (#794). Longer than the toolbar's 300 ms search debounce, so the new
 * request has started (and `loading` is true) before the count is read.
 */
export const SETTLE_MS = 500;

/**
 * Quiet kept after a load ends before speaking, so the list's new total has
 * synced into pagination (`SyncTotal` sets it in an effect) first.
 */
export const MIN_QUIET_MS = 100;

/** A load shorter than this says nothing until its result (#794). */
export const LOADING_DELAY_MS = 500;

/**
 * The gap between clearing the live region and writing the new text. Without
 * one, the same text twice in a row isn't a change a screen reader notices.
 */
export const REANNOUNCE_GAP_MS = 100;

/** What a screen reader hears for a result count (#794). */
export const announcementFor = (total: number): string =>
  total === 0
    ? "No results found"
    : total === 1
      ? "1 result"
      : `${total.toLocaleString()} results`;

export interface ResultsAnnouncerState {
  loading: boolean;
  total: number;
  currentPage: number;
  totalPages: number;
}

export interface ResultsAnnouncer {
  /** Text for a persistent, visually hidden `StatusMessage`. */
  announcement: string;
  /** Call on every user change (search, filter, sort, page size, page). */
  markChange: () => void;
}

/**
 * Speaks a list's result after the user changes it (#794): "12 results,
 * page 1 of 2", "No results found", or "Loading results…" for a slow load.
 * Nothing is said on arrival, when the route announcer's h1 has the floor,
 * and typing isn't announced per key: each change restarts the settle.
 */
export function useResultsAnnouncer({
  loading,
  total,
  currentPage,
  totalPages,
}: ResultsAnnouncerState): ResultsAnnouncer {
  const [announcement, setAnnouncement] = React.useState("");
  const [changeTick, setChangeTick] = React.useState(0);
  const pending = React.useRef(false);
  const lastChangeAt = React.useRef(0);
  const sayTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const markChange = React.useCallback(() => {
    pending.current = true;
    lastChangeAt.current = Date.now();
    setChangeTick((t) => t + 1);
  }, []);

  // Clearing first, then writing after a short gap, makes the same text
  // twice in a row a change the live region announces.
  const say = React.useCallback((text: string) => {
    setAnnouncement("");
    if (sayTimer.current) clearTimeout(sayTimer.current);
    sayTimer.current = setTimeout(
      () => setAnnouncement(text),
      REANNOUNCE_GAP_MS
    );
  }, []);

  React.useEffect(
    () => () => {
      if (sayTimer.current) clearTimeout(sayTimer.current);
    },
    []
  );

  React.useEffect(() => {
    if (!pending.current) return;
    if (loading) {
      const t = setTimeout(() => say("Loading results…"), LOADING_DELAY_MS);
      return () => clearTimeout(t);
    }
    const wait = Math.max(
      SETTLE_MS - (Date.now() - lastChangeAt.current),
      MIN_QUIET_MS
    );
    const t = setTimeout(() => {
      pending.current = false;
      const page =
        totalPages > 1 ? `, page ${currentPage} of ${totalPages}` : "";
      say(`${announcementFor(total)}${page}`);
    }, wait);
    return () => clearTimeout(t);
  }, [changeTick, loading, total, currentPage, totalPages, say]);

  return { announcement, markChange };
}
