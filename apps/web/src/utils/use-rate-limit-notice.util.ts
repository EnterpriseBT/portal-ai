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
 * A longer refusal that extends the running window replaces the notice, so
 * it names, and lasts for, the wait that actually holds reads.
 *
 * Mounted once, in `ApplicationProvider`, so every page gets it whatever its
 * layout (the portal page uses `FullScreenLayout`).
 */
export function useRateLimitNotice(): void {
  const toast = useToast();
  const noticeId = useRef<string | null>(null);

  useEffect(
    () =>
      onApiRateLimitWindow(({ waitMs, extended }) => {
        if (extended && noticeId.current) toast.dismiss(noticeId.current);
        const seconds = Math.ceil(waitMs / 1_000);
        noticeId.current = toast.warning(
          `You're making requests faster than allowed. Data will load again in ${inSeconds(seconds)}.`,
          { autoHideMs: waitMs }
        );
      }),
    [toast]
  );
}
