import type React from "react";

/**
 * What counts as a control when a row or card forwards a click to its link
 * (#794): a click on one of these keeps its own behaviour. One selector, so
 * tables and cards can't drift apart.
 */
export const INTERACTIVE_SELECTOR =
  "a, button, input, select, textarea, [role=button], [role=checkbox], [role=combobox], [role=switch], [tabindex]:not([tabindex='-1'])";

/**
 * Whether a click inside `container` landed on a control of its own. A grid
 * cell (focusable for keyboard navigation) isn't a control, and nothing
 * outside the container counts.
 */
export function isControlClick(
  target: EventTarget | null,
  container: HTMLElement
): boolean {
  if (!(target instanceof Element)) return false;
  const hit = target.closest<HTMLElement>(INTERACTIVE_SELECTOR);
  return (
    !!hit &&
    hit !== container &&
    container.contains(hit) &&
    !hit.hasAttribute("data-grid-cell")
  );
}

/**
 * Activates a row's or card's own link or button as the user's click would.
 * A Ctrl/Cmd/Shift-click or a middle click on a link opens it in a new tab,
 * since a forwarded `.click()` carries no modifiers.
 */
export function followClick(
  control: HTMLElement | null,
  e: React.MouseEvent
): void {
  if (!control) return;
  const href = control instanceof HTMLAnchorElement ? control.href : null;
  const newTab = e.button === 1 || e.ctrlKey || e.metaKey || e.shiftKey;
  if (href && newTab) {
    window.open(href, "_blank", "noopener");
    return;
  }
  if (e.button !== 0) return;
  control.click();
}
