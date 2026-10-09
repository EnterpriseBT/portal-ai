import { useEffect } from "react";

import { onApiRateLimitWindow } from "./rate-limit.util";
import { useToast } from "./toast.context";

const inSeconds = (s: number) => (s === 1 ? "1 second" : `${s} seconds`);

/**
 * #747: the one notice for a spent API bucket. Every read on screen is
 * refused at once when the bucket runs out, so this raises a single warning
 * per window, naming the wait, instead of each read painting its own error.
 * A warning, not an error: the reads recover by themselves, so nothing waits
 * on the user. Mutations still report through their own surfaces.
 */
export function useRateLimitNotice(): void {
  const toast = useToast();

  useEffect(
    () =>
      onApiRateLimitWindow((waitMs) => {
        const seconds = Math.ceil(waitMs / 1_000);
        toast.warning(
          `You're making requests faster than allowed. This page will refresh by itself in ${inSeconds(seconds)}.`
        );
      }),
    [toast]
  );
}
