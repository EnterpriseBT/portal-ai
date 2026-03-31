import { useRef, useEffect } from "react";

/**
 * Returns an inputRef that focuses the element after a MUI Dialog opens.
 * Use this instead of the native `autoFocus` prop on TextFields inside
 * Modal/Dialog components to avoid the aria-hidden focus conflict.
 */
export function useDialogAutoFocus<T extends HTMLElement = HTMLInputElement>(
  open: boolean
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    // Defer focus until after MUI Dialog's transition + focus trap settles
    const timer = setTimeout(() => {
      ref.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [open]);

  return ref;
}
