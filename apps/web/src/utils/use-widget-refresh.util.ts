import { useCallback, useEffect, useRef, useState } from "react";

import { VIZ_REFRESH_FRESHNESS_MS } from "@portalai/core/constants";
import type { BlockRef } from "@portalai/core";
import type { WidgetRefreshResponse } from "@portalai/core/contracts";

import { sdk } from "../api/sdk";
import { toServerError, type ServerError } from "./api.util";
import { pinDataRefusal } from "./pin-data.util";

/**
 * Session-scoped last-hydration clock, keyed by the discriminated BlockRef
 * (#312) — `message:<id>:<idx>` / `pin:<id>` never collide. Module-level so
 * it survives remounts — a widget viewed repeatedly within the freshness
 * window refetches at most once (#270 D6). Not persisted; a page reload
 * starts fresh.
 */
const lastHydratedAt = new Map<string, number>();
const keyOf = (ref: BlockRef): string =>
  ref.kind === "message"
    ? `message:${ref.messageId}:${ref.blockIndex}`
    : `pin:${ref.portalResultId}`;

export interface UseWidgetRefreshResult {
  /** Whether this caller may refresh the block at all: any persisted block.
   *  A pin's data is a read (#640), so every reader of a pin may. Gates both
   *  the mount refresh and the manual button. */
  allowed: boolean;
  /** Fresh delivery from the last successful refresh, or null. */
  fresh: WidgetRefreshResponse | null;
  isRefreshing: boolean;
  /** A refresh failure other than "not refreshable". */
  error: ServerError | null;
  /** The widget predates durable pipelines (server 422) — can't refresh. */
  notRefreshable: boolean;
  /** Epoch ms of the last hydration (seeded from the block's data timestamp). */
  lastUpdatedAt: number | null;
  refresh: () => void;
}

/**
 * Freshness-gated widget refresh (#270 D6, promoted + widened in #312).
 * Auto-refreshes once on mount when the data is stale (older than
 * `VIZ_REFRESH_FRESHNESS_MS`, seeded from `dataUpdatedAt`), and exposes
 * `refresh()` for the always-present manual button. A just-minted widget
 * (`dataUpdatedAt ≈ now`) is fresh and skips the auto-refresh. Absent
 * `blockRef` (streaming/unpersisted) → no refresh at all.
 *
 * Dispatch follows the ref's kind: message-block refs hit the
 * widget-refresh endpoint. A pin stores no data (#640): its data is always
 * the live `portalResults.data` query, cached for the freshness window, and
 * the manual button refetches it.
 */
export function useWidgetRefresh(
  blockRef: BlockRef | undefined,
  dataUpdatedAt: number | undefined
): UseWidgetRefreshResult {
  const key = blockRef ? keyOf(blockRef) : undefined;
  // The mount refresh and the manual button below serve message blocks; a
  // pin's data comes from its live query.
  const allowed = blockRef?.kind === "message";
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;

  const pinId = blockRef?.kind === "pin" ? blockRef.portalResultId : "";
  const pinData = sdk.portalResults.data(pinId, { enabled: pinId !== "" });

  const { mutateAsync: refreshMessageBlock } = sdk.portalSql.widgetRefresh();
  const [fresh, setFresh] = useState<WidgetRefreshResponse | null>(null);
  const [error, setError] = useState<ServerError | null>(null);
  const [notRefreshable, setNotRefreshable] = useState(false);
  // Own the in-flight flag rather than react-query's `isPending`, which did
  // not reliably clear here (the button spun forever after a resolved
  // refresh). A `try/finally` guarantees the spinner ends when refresh() does.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(() =>
    key != null ? (lastHydratedAt.get(key) ?? dataUpdatedAt ?? null) : null
  );

  // Keep the ref itself stable for the callback without spreading its
  // variant fields into dependency arrays.
  const refRef = useRef(blockRef);
  refRef.current = blockRef;

  const refresh = useCallback(async () => {
    const ref = refRef.current;
    if (ref == null || !allowedRef.current) return;
    if (ref.kind !== "message") return;
    setIsRefreshing(true);
    try {
      const res = await refreshMessageBlock({
        messageId: ref.messageId,
        blockIndex: ref.blockIndex,
      });
      const now = Date.now();
      lastHydratedAt.set(keyOf(ref), now);
      setError(null);
      setFresh(res);
      setLastUpdatedAt(now);
    } catch (e) {
      const se = toServerError(e as never);
      if (se?.code === "VIZ_WIDGET_NOT_REFRESHABLE") {
        setNotRefreshable(true);
      } else {
        setError(se);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshMessageBlock]);

  // Auto-refresh once on mount when stale. #271 owns the viewport-driven
  // trigger that fans this across many widgets on a dashboard.
  const autoFired = useRef(false);
  useEffect(() => {
    if (key == null || !allowed || autoFired.current) return;
    const seededAt = lastHydratedAt.get(key) ?? dataUpdatedAt ?? 0;
    if (Date.now() - seededAt > VIZ_REFRESH_FRESHNESS_MS) {
      autoFired.current = true;
      // Mount-triggered async fetch (fires once per stale mount). #271 owns the
      // viewport-driven trigger for many widgets.
      void refresh();
    }
  }, [key, allowed, dataUpdatedAt, refresh]);

  if (blockRef?.kind === "pin") {
    const refusal = pinDataRefusal(pinData.error);
    return {
      allowed: true,
      fresh: pinData.data ?? null,
      isRefreshing: pinData.isFetching,
      // A refusal is the pin's state, which its view renders in place of the
      // block; only an unexpected failure is the widget's error.
      error: refusal ? null : toServerError(pinData.error),
      notRefreshable: refusal === "not-reexecutable",
      lastUpdatedAt: pinData.dataUpdatedAt || null,
      refresh: () => void pinData.refetch(),
    };
  }

  return {
    allowed,
    fresh,
    isRefreshing,
    error,
    notRefreshable,
    lastUpdatedAt,
    refresh: () => void refresh(),
  };
}
