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

/**
 * A form `onKeyDown` that keeps Enter on a checkbox or radio from submitting
 * (#789). Browsers treat it as implicit submission (without toggling the
 * control), so Tabbing to a checkbox and pressing Enter ran the dialog's
 * submit. A focused control that isn't a text field owns Enter: buttons
 * already do (Enter clicks them), and this gives toggles the same rule.
 */
export function preventToggleEnterSubmit(
  event: React.KeyboardEvent<HTMLElement>
): void {
  const target = event.target as HTMLInputElement;
  if (
    event.key === "Enter" &&
    target.tagName === "INPUT" &&
    (target.type === "checkbox" || target.type === "radio")
  ) {
    event.preventDefault();
  }
}
