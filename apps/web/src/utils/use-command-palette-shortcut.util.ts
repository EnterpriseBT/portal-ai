import { useEffect } from "react";

export type PalettePlatform = "mac" | "other";

/** ⌘K on a Mac, Ctrl+K elsewhere, with no Shift or Alt (#1076). */
export function isPaletteShortcut(
  event: KeyboardEvent,
  platform: PalettePlatform
): boolean {
  if (event.key !== "k" && event.key !== "K") return false;
  if (event.altKey || event.shiftKey) return false;
  return platform === "mac" ? event.metaKey : event.ctrlKey;
}

/** The OS family, for which shortcut to listen for and show. */
export function detectPlatform(): PalettePlatform {
  if (typeof navigator === "undefined") return "other";
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad/i.test(platform) ? "mac" : "other";
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return !!target.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]'
  );
}

/**
 * The palette's global shortcut (#1076). It toggles the palette, but while
 * the palette is closed it stands down when focus is in a text field, in
 * the RegionEditor's sheet (which owns its keys and isn't always in a
 * dialog), or when another dialog is open.
 */
export function useCommandPaletteShortcut({
  open,
  onToggle,
  platform,
}: {
  open: boolean;
  onToggle: () => void;
  platform: PalettePlatform;
}): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isPaletteShortcut(event, platform)) {
        return;
      }
      if (!open) {
        if (isEditable(event.target)) return;
        if (
          event.target instanceof Element &&
          event.target.closest("[data-sheet-surface]")
        ) {
          return;
        }
        if (document.querySelector('[role="dialog"]')) return;
      }
      event.preventDefault();
      onToggle();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onToggle, platform]);
}
