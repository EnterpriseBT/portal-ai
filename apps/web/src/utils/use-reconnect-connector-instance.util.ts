import { useCallback, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { sdk, queryKeys } from "../api/sdk";
import {
  PopupClosedError,
  useOAuthPopupAuthorize,
} from "./oauth-popup.util";
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
 * Mints an OAuth consent URL for the supplied connector slug, opens
 * the popup with the slug-matching postMessage shape, then invalidates
 * the connector instance query so the UI picks up the server-side
 * `status: error → active` reset (callbacks flip status + clear
 * `lastErrorMessage` when they find an existing instance to update).
 *
 * Slug dispatch is hand-rolled here. Both SDK authorize hooks are
 * called unconditionally (rules of hooks); the click handler picks
 * which `mutateAsync` to invoke based on the supplied
 * `definitionSlug`. The `useOAuthPopupAuthorize` hook is itself
 * slug-parameterized so a single instance routes to the right
 * postMessage type.
 *
 * Promote to an adapter-routed dispatch if a third OAuth-driven
 * connector lands.
 */
export const useReconnectConnectorInstance = (
  connectorInstanceId: string,
  definitionSlug: string
): ConnectorInstanceReconnectState => {
  const queryClient = useQueryClient();
  const { mutateAsync: googleAuthorize } = sdk.googleSheets.authorize();
  const { mutateAsync: microsoftAuthorize } = sdk.microsoftExcel.authorize();
  const popup = useOAuthPopupAuthorize({
    slug: definitionSlug,
    allowedOrigin: apiOrigin(),
  });

  const [isReconnecting, setIsReconnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onReconnect = useCallback(async () => {
    setErrorMessage(null);
    setIsReconnecting(true);
    try {
      let url: string;
      switch (definitionSlug) {
        case "google-sheets":
          ({ url } = await googleAuthorize(undefined as never));
          break;
        case "microsoft-excel":
          ({ url } = await microsoftAuthorize(undefined as never));
          break;
        default:
          throw new Error(
            `Reconnect is not supported for connector slug "${definitionSlug}"`
          );
      }
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
  }, [
    googleAuthorize,
    microsoftAuthorize,
    definitionSlug,
    popup,
    queryClient,
    connectorInstanceId,
  ]);

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
