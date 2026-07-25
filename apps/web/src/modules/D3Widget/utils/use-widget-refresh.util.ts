import { useCallback, useEffect, useRef, useState } from "react";

import { VIZ_REFRESH_FRESHNESS_MS } from "@portalai/core/constants";
import type { WidgetRefreshResponse } from "@portalai/core/contracts";

import { sdk } from "../../../api/sdk";
import { toServerError, type ServerError } from "../../../utils/api.util";

export interface WidgetRef {
  messageId: string;
  blockIndex: number;
}

/**
 * Session-scoped last-hydration clock, keyed by widget. Module-level so it
 * survives remounts — a widget viewed repeatedly within the freshness window
 * refetches at most once (#270 D6). Not persisted; a page reload starts fresh.
 */
const lastHydratedAt = new Map<string, number>();
const keyOf = (messageId: string, blockIndex: number) =>
  `${messageId}:${blockIndex}`;

export interface UseWidgetRefreshResult {
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
 * Freshness-gated widget refresh (#270 D6). Auto-refreshes once on mount when
 * the data is stale (older than `VIZ_REFRESH_FRESHNESS_MS`, seeded from
 * `dataUpdatedAt`), and exposes `refresh()` for the always-present manual
 * button. A just-minted widget (`dataUpdatedAt ≈ now`) is fresh and skips the
 * auto-refresh. Absent `blockRef` (streaming/unpersisted) → no refresh at all.
 */
export function useWidgetRefresh(
  blockRef: WidgetRef | undefined,
  dataUpdatedAt: number | undefined
): UseWidgetRefreshResult {
  const messageId = blockRef?.messageId;
  const blockIndex = blockRef?.blockIndex;

  const { mutateAsync, isPending } = sdk.portalSql.widgetRefresh();
  const [fresh, setFresh] = useState<WidgetRefreshResponse | null>(null);
  const [error, setError] = useState<ServerError | null>(null);
  const [notRefreshable, setNotRefreshable] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(() =>
    messageId != null && blockIndex != null
      ? (lastHydratedAt.get(keyOf(messageId, blockIndex)) ??
        dataUpdatedAt ??
        null)
      : null
  );

  const refresh = useCallback(async () => {
    if (messageId == null || blockIndex == null) return;
    // No synchronous setState here — the first state update lands only after
    // the await, so auto-refresh from the mount effect doesn't cascade renders.
    try {
      const res = await mutateAsync({ messageId, blockIndex });
      const now = Date.now();
      lastHydratedAt.set(keyOf(messageId, blockIndex), now);
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
    }
  }, [messageId, blockIndex, mutateAsync]);

  // Auto-refresh once on mount when stale. #271 owns the viewport-driven
  // trigger that fans this across many widgets on a dashboard.
  const autoFired = useRef(false);
  useEffect(() => {
    if (messageId == null || blockIndex == null || autoFired.current) return;
    const seededAt =
      lastHydratedAt.get(keyOf(messageId, blockIndex)) ?? dataUpdatedAt ?? 0;
    if (Date.now() - seededAt > VIZ_REFRESH_FRESHNESS_MS) {
      autoFired.current = true;
      // Mount-triggered async fetch: refresh() sets state only after its await,
      // so this doesn't cascade renders — the static rule can't see the defer.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void refresh();
    }
  }, [messageId, blockIndex, dataUpdatedAt, refresh]);

  return {
    fresh,
    isRefreshing: isPending,
    error,
    notRefreshable,
    lastUpdatedAt,
    refresh: () => void refresh(),
  };
}
