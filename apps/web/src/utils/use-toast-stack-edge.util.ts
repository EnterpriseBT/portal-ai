import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { toastStackEdge } from "./toast-placement.util";

import type { RefObject } from "react";
import type { ToastStackEdge } from "./toast-placement.util";

/**
 * Which edge the toast stack sits on, so it never hides keyboard focus
 * (#1024, WCAG 2.4.11). `ToastHost` calls it with its own element, which it
 * measures; the geometry is `toastStackEdge`.
 *
 * Re-checked when focus moves (at once, and again after the browser has
 * scrolled it into view), on any scroll or resize (once per frame), and when
 * the stack's contents change (`toasts`, `hiddenCount`: a new toast can reach
 * a control that already has focus).
 *
 * Only keyboard focus moves the stack up. A pointer user who clicks near the
 * corner keeps it where they're looking; it still comes back down for any
 * focus that's clear of the bottom.
 */
export function useToastStackEdge(
  hostRef: RefObject<HTMLElement | null>,
  inset: number,
  toasts: unknown,
  hiddenCount: number
): ToastStackEdge {
  const [edge, setEdge] = useState<ToastStackEdge>("bottom");
  /** The last input was a key press (not a pointer press). */
  const keyboard = useRef(false);

  const place = useCallback(
    (target: Element | null) => {
      const host = hostRef.current;
      // Focus inside the stack never moves it.
      if (!host || (target && host.contains(target))) return;
      const stack = host.getBoundingClientRect();
      const focus =
        target && target !== document.body
          ? target.getBoundingClientRect()
          : null;
      // The layout viewport, without a scrollbar, which is what a fixed
      // `right` is measured from (jsdom reports 0, hence the fallback).
      const root = document.documentElement;
      const next = toastStackEdge(
        focus,
        { width: stack.width, height: stack.height },
        {
          width: root.clientWidth || window.innerWidth,
          height: root.clientHeight || window.innerHeight,
        },
        inset
      );
      setEdge((prev) =>
        next === "top" && prev === "bottom" && !keyboard.current
          ? "bottom"
          : next
      );
    },
    [hostRef, inset]
  );

  useEffect(() => {
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => place(document.activeElement));
    };
    const onFocusIn = (e: FocusEvent) => {
      place(e.target instanceof Element ? e.target : null);
      later();
    };
    const onKeyDown = () => {
      keyboard.current = true;
    };
    const onPointerDown = () => {
      keyboard.current = false;
    };
    const opts = { capture: true, passive: true } as const;
    document.addEventListener("keydown", onKeyDown, opts);
    document.addEventListener("pointerdown", onPointerDown, opts);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("scroll", later, opts);
    window.addEventListener("resize", later);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("scroll", later, { capture: true });
      window.removeEventListener("resize", later);
    };
  }, [place]);

  useLayoutEffect(() => {
    place(document.activeElement);
  }, [toasts, hiddenCount, place]);

  return edge;
}
