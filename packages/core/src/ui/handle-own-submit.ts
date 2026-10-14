import type React from "react";

/**
 * A form `onSubmit` that acts only on its own form's submit (#789).
 *
 * React bubbles a submit event through portals, so a form rendered inside a
 * nested dialog or popover reaches every ancestor form's `onSubmit` too.
 * Without this check, submitting a child form would also fire its parent's
 * action. A bubbled submit is left alone (its own form prevents the default);
 * our own is prevented and runs `run`.
 */
export function handleOwnSubmit(
  run: () => void
): (event: React.FormEvent<HTMLFormElement>) => void {
  return (event) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    run();
  };
}
