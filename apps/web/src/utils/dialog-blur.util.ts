import type React from "react";

/**
 * True when focus is leaving a field for one of its dialog's own controls:
 * an action button (Cancel, Save) or a header control (close, maximize).
 * `Modal` marks those regions with `data-dialog-controls` (#789).
 *
 * A dialog's blur handler returns early in that case instead of marking the
 * field touched. Clicking Cancel on an empty required field then closes the
 * dialog without flashing "Name is required", and clicking Save still
 * validates, because submit marks every field touched itself.
 */
export function isDialogControlBlur(event: React.FocusEvent): boolean {
  const next = event.relatedTarget as Element | null;
  return next?.closest?.("[data-dialog-controls]") != null;
}

/** An `onBlur` handler that runs `run` unless focus is moving to one of the
 *  dialog's own controls (see `isDialogControlBlur`). */
export function blurUnlessDialogControl(
  run: () => void
): (event: React.FocusEvent) => void {
  return (event) => {
    if (!isDialogControlBlur(event)) run();
  };
}
