import { useCallback, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { sdk, queryKeys } from "../api/sdk";
import {
  PopupClosedError,
  useGooglePopupAuthorize,
} from "../workflows/GoogleSheetsConnector/utils/google-sheets-popup.util";
import { apiOrigin } from "./api-origin.util";

export interface ConnectorInstanceReconnectState {
  /** Reconnect popup + token-exchange round-trip in flight. */
  isReconnecting: boolean;
  /** Error from the last reconnect attempt (if any). Null on success / dismiss. */
  errorMessage: string | null;
  /** Click handler — opens the OAuth popup. */
  onReconnect: () => void;
  /** Dismisses the error alert. */
  onDismissError: () => void;
}

/**
 * Drives the connector-instance reconnect flow.
 *
 * Mints an OAuth consent URL, opens the popup, awaits the postMessage
 * handshake, then invalidates the connector instance query so the UI
 * picks up the server-side status reset (Phase E Slice 1: the callback
 * flips status `error → active` and clears `lastErrorMessage` when it
 * finds an existing instance to update).
 *
 * The hook surface mirrors `useConnectorInstanceSync` so the trigger
 * UI and any failure-feedback consumer can share state from one hook
 * call instead of fighting React's effect graph.
 *
 * Note: today this is gsheets-specific (the popup hook expects
 * Google's postMessage shape). When a second OAuth-driven connector
 * lands, lift the popup orchestration behind an adapter-routed
 * dispatch (the connector instance's definition slug picks the right
 * SDK + popup hook).
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-E.plan.md` §Slice 2.
 */
export const useReconnectConnectorInstance = (
  connectorInstanceId: string
): ConnectorInstanceReconnectState => {
  const queryClient = useQueryClient();
  const { mutateAsync: authorizeMutate } = sdk.googleSheets.authorize();
  const popup = useGooglePopupAuthorize({ allowedOrigin: apiOrigin() });

  const [isReconnecting, setIsReconnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onReconnect = useCallback(async () => {
    setErrorMessage(null);
    setIsReconnecting(true);
    try {
      const { url } = await authorizeMutate(undefined as never);
      await popup.start(url);
      // The callback updated the instance row (status → active, error
      // cleared); refetch so the page state reflects the new server
      // truth without requiring a manual refresh.
      queryClient.invalidateQueries({
        queryKey: queryKeys.connectorInstances.get(connectorInstanceId),
      });
    } catch (err) {
      // User dismissed the popup → silent. Anything else gets surfaced.
      if (err instanceof PopupClosedError) return;
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsReconnecting(false);
    }
  }, [authorizeMutate, popup, queryClient, connectorInstanceId]);

  const onDismissError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  return {
    isReconnecting,
    errorMessage,
    onReconnect,
    onDismissError,
  };
};
