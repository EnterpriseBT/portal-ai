import { useEffect, useRef } from "react";

import { onApiRateLimitWindow } from "./rate-limit.util";
import { useToast } from "./toast.context";

const inSeconds = (s: number) => (s === 1 ? "1 second" : `${s} seconds`);

/**
 * #747: the one notice for a spent API bucket. Every read on screen is
 * refused at once when the bucket runs out, so this raises a single warning
 * per window, naming the wait, instead of each read painting its own error.
 * A warning, not an error: the reads recover by themselves, so nothing waits
 * on the user. It stays up for the wait it names, since the default warning
 * duration is far shorter than a window. Mutations still report through
 * their own surfaces.
 *
 * Each new or extended window replaces the previous notice, so it names the
 * wait that actually holds reads and two never stack. The notice also ends at
 * its window's end: a toast's own auto-hide starts only once it is visible,
 * so one queued behind others would outlive the wait it names.
 *
 * Mounted once, in `ApplicationProvider`, so every page gets it whatever its
 * layout (the portal page uses `FullScreenLayout`).
 */
export function useRateLimitNotice(): void {
  const toast = useToast();
  const noticeId = useRef<string | null>(null);
  const noticeExpiry = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearExpiry = () => {
      if (noticeExpiry.current !== null) clearTimeout(noticeExpiry.current);
      noticeExpiry.current = null;
    };
    const unsubscribe = onApiRateLimitWindow(({ waitMs }) => {
      // Dismissed before raising, so the new notice is never dropped as a
      // duplicate of the one it replaces.
      if (noticeId.current) toast.dismiss(noticeId.current);
      clearExpiry();
      const seconds = Math.ceil(waitMs / 1_000);
      const id = toast.warning(
        `You're making requests faster than allowed. Data will load again in ${inSeconds(seconds)}.`,
        { autoHideMs: waitMs }
      );
      noticeId.current = id;
      noticeExpiry.current = setTimeout(() => {
        toast.dismiss(id);
        noticeId.current = null;
        noticeExpiry.current = null;
      }, waitMs);
    });
    return () => {
      unsubscribe();
      clearExpiry();
    };
  }, [toast]);
}
