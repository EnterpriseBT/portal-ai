import { useCallback, useEffect, useRef, useState } from "react";

import type { BlockRef } from "@portalai/core";
import type { WidgetRefreshResponse } from "@portalai/core/contracts";

import { sdk } from "../api/sdk";
import { toServerError, type ServerError } from "./api.util";
import { pinDataRefusal } from "./pin-data.util";

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
  /** #1038: the caller can no longer read what the widget's query reads
   *  (server 422 `VIZ_WIDGET_DATA_UNAVAILABLE`). Nothing is shown. */
  unavailable: boolean;
  /** Epoch ms of the read that drew the widget; null until one completes. */
  lastUpdatedAt: number | null;
  refresh: () => void;
}

/**
 * A persisted widget's data, read live (#270, #312, #1038). A stored message
 * block keeps its recipe, never its rows, so every mount reads it as the
 * caller and exposes `refresh()` for the always-present manual button. The
 * widget paints only what a read returns: a reader who lost access to the
 * data sees "no longer available", never a stored copy. Absent `blockRef`
 * (the turn still streaming) → no read; the widget draws the live delivery.
 *
 * Dispatch follows the ref's kind: message-block refs hit the
 * widget-refresh endpoint. A pin stores no data (#640): its data is always
 * the live `portalResults.data` query, cached for the freshness window, and
 * the manual button refetches it.
 */
export function useWidgetRefresh(
  blockRef: BlockRef | undefined
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
  const [unavailable, setUnavailable] = useState(false);
  // Own the in-flight flag rather than react-query's `isPending`, which did
  // not reliably clear here (the button spun forever after a resolved
  // refresh). A `try/finally` guarantees the spinner ends when refresh() does.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

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
      setError(null);
      setUnavailable(false);
      setFresh(res);
      setLastUpdatedAt(Date.now());
    } catch (e) {
      const se = toServerError(e as never);
      if (se?.code === "VIZ_WIDGET_NOT_REFRESHABLE") {
        setNotRefreshable(true);
      } else if (se?.code === "VIZ_WIDGET_DATA_UNAVAILABLE") {
        // Drop anything an earlier read drew: access ended since.
        setFresh(null);
        setLastUpdatedAt(null);
        setUnavailable(true);
      } else {
        setError(se);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshMessageBlock]);

  // Read once on mount (#1038): a stored block has no rows of its own. The
  // gates (#271) mount a widget only near the viewport, which bounds this.
  const autoFired = useRef(false);
  useEffect(() => {
    if (key == null || !allowed || autoFired.current) return;
    autoFired.current = true;
    void refresh();
  }, [key, allowed, refresh]);

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
      unavailable: false,
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
    unavailable,
    lastUpdatedAt,
    refresh: () => void refresh(),
  };
}
