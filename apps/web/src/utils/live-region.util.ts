import React from "react";

/**
 * The gap between clearing a live region and writing the new text. Without
 * one, the same text twice in a row isn't a change a screen reader notices
 * (#794; shared with the region editor's announcer, #795).
 */
export const REANNOUNCE_GAP_MS = 100;

/**
 * Text for a hidden live region, and `say` to change it. `say` clears first
 * and writes after `REANNOUNCE_GAP_MS`, so a repeat is still announced; a
 * later `say` replaces an earlier one still waiting.
 */
export function useLiveAnnouncement(): {
  announcement: string;
  say: (text: string) => void;
} {
  const [announcement, setAnnouncement] = React.useState("");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = React.useCallback((text: string) => {
    setAnnouncement("");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAnnouncement(text), REANNOUNCE_GAP_MS);
  }, []);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return { announcement, say };
}
