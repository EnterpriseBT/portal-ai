import { useEffect, useRef, useState } from "react";

import { sdk } from "../../../api/sdk";
import { D3_SNAPSHOT_PAGE_SIZE } from "./bridge.util";

/**
 * Progressive row delivery for handle-backed d3 blocks (#268): pages the
 * snapshot endpoint from offset 0 at the handle service's batch grain and
 * emits each page as an ordered batch — the widget forwards them over the
 * bridge as they land, so the first paint never waits for the full set.
 */

export interface ProgressiveBatch {
  rows: Array<Record<string, unknown>>;
  seq: number;
  done: boolean;
}

export interface ProgressiveRowsState {
  /** Batches in arrival order — ordering is the bridge's `seq` contract. */
  batches: ProgressiveBatch[];
  receivedRows: number;
  complete: boolean;
  error: string | null;
}

const INITIAL_STATE: ProgressiveRowsState = {
  batches: [],
  receivedRows: 0,
  complete: false,
  error: null,
};

const toErrorMessage = (error: unknown): string => {
  if ((error as { code?: string }).code === "READ_HANDLE_EXPIRED") {
    // Same copy as QueryResultDataBlock — the refresh affordance is #270.
    return "The chart's data has expired from cache. Re-run the original query to refresh.";
  }
  return error instanceof Error ? error.message : "Unknown error";
};

export function useProgressiveHandleRows(
  queryHandle: string | null
): ProgressiveRowsState {
  const { mutateAsync } = sdk.portalSql.handleSnapshotPage();
  const [state, setState] = useState<ProgressiveRowsState>(INITIAL_STATE);

  // react-query doesn't guarantee a stable mutateAsync identity; a ref
  // keeps the paging effect keyed on the handle alone.
  const fetchPage = useRef(mutateAsync);
  fetchPage.current = mutateAsync;

  useEffect(() => {
    if (!queryHandle) return;
    let cancelled = false;
    setState(INITIAL_STATE);

    (async () => {
      let offset = 0;
      let seq = 0;
      // Strictly sequential: page N+1 is requested only after N resolves,
      // so batch order (the bridge's seq contract) is enforced by the
      // loop, not by response timing.
      for (;;) {
        let payload;
        try {
          payload = await fetchPage.current({
            handleId: queryHandle,
            offset,
            limit: D3_SNAPSHOT_PAGE_SIZE,
          });
        } catch (error) {
          if (!cancelled) {
            setState((s) => ({ ...s, error: toErrorMessage(error) }));
          }
          return;
        }
        if (cancelled) return;

        const rows = payload.rows ?? [];
        const done =
          rows.length < D3_SNAPSHOT_PAGE_SIZE ||
          offset + rows.length >= payload.total;
        const batch: ProgressiveBatch = { rows, seq, done };
        setState((s) => ({
          batches: [...s.batches, batch],
          receivedRows: s.receivedRows + rows.length,
          complete: done,
          error: null,
        }));
        if (done) return;
        offset += rows.length;
        seq += 1;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [queryHandle]);

  return state;
}
