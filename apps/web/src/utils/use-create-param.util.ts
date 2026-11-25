import { useEffect, useRef } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import type { ActionGate } from "@portalai/core/ui";

/**
 * #1076: an index page's `?create=<kind>` deep link (the command palette's
 * create actions). Once the page is `ready` (capabilities known, and any
 * catalog it needs loaded), a value that the route's `validateSearch`
 * accepted opens the page's own create dialog when its gate allows; either
 * way the param is then removed (replace), so Back or a reload doesn't
 * reopen it. It reacts to the param changing, not only to mount, so a link
 * from the same page works too.
 */
export function useCreateParam({
  gate,
  ready,
  onOpen,
}: {
  gate: ActionGate;
  ready: boolean;
  onOpen: (create: string) => void;
}): void {
  // The location, not the match (CLAUDE.md → Addressable sections).
  const create = useRouterState({
    select: (s) => (s.location.search as Record<string, unknown>).create,
  });
  const navigate = useNavigate();
  // The latest callback, so a caller can pass an inline function without
  // re-running the effect on every render.
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    if (typeof create !== "string" || !ready) return;
    if (gate.kind === "allow") onOpenRef.current(create);
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => {
        const { create: _consumed, ...rest } = prev;
        return rest;
      },
      replace: true,
    } as never);
  }, [create, ready, gate.kind, navigate]);
}
