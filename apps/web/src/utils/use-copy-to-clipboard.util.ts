import { useEffect, useRef, useState } from "react";

/** How long the "Copied" confirmation shows before reverting. */
const COPIED_MS = 2000;

/**
 * Copy text to the clipboard and report it with a short-lived `copied`
 * flag, for a copy button's "Copied" state. A failed write (an insecure
 * context, a denied permission) leaves `copied` false, so the button never
 * claims a copy that didn't happen; the text stays selectable for a manual
 * copy.
 */
export function useCopyToClipboard(): {
  copied: boolean;
  copy: (text: string) => Promise<void>;
} {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return { copied, copy };
}
