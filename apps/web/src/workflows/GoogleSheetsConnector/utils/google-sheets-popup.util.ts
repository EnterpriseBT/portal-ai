/**
 * OAuth popup handshake hook.
 *
 * Opens a popup pointed at the Google consent URL, listens for the
 * `google-sheets-authorized` postMessage that the API's callback HTML
 * emits, resolves with `{ connectorInstanceId, accountInfo }`. Origin-
 * locked to the allowed origin (the API host) so a malicious page
 * can't postMessage a forged payload.
 *
 * The window.open call MUST run synchronously inside the user's click
 * handler — browsers block popups opened in async continuations.
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-C.plan.md` §Slice 2.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { PublicAccountInfo } from "@portalai/core/contracts";

const POPUP_FEATURES = "width=520,height=640,menubar=no,toolbar=no,location=yes";
const POPUP_NAME = "google-sheets-oauth";
const POPUP_POLL_INTERVAL_MS = 500;
const MESSAGE_TYPE = "google-sheets-authorized";

export interface PopupAuthorizeResult {
  connectorInstanceId: string;
  accountInfo: PublicAccountInfo;
}

export class PopupClosedError extends Error {
  override readonly name = "PopupClosedError" as const;
  constructor(message = "Authorization popup was closed before completing") {
    super(message);
  }
}

export interface UseGooglePopupAuthorizeOptions {
  /**
   * Origin that the API's callback HTML serves from. Required for
   * `event.origin` validation. Pass `import.meta.env.VITE_API_BASE_URL`'s
   * origin from the consumer.
   */
  allowedOrigin: string;
}

export interface UseGooglePopupAuthorizeResult {
  /**
   * Open the popup and return a promise that resolves with the
   * authorize payload, or rejects with `PopupClosedError` if the user
   * closes the popup before the callback completes.
   */
  start: (consentUrl: string) => Promise<PopupAuthorizeResult>;
}

interface ExpectedMessage {
  type: typeof MESSAGE_TYPE;
  connectorInstanceId: string;
  accountInfo: PublicAccountInfo;
}

function isExpectedMessage(value: unknown): value is ExpectedMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === MESSAGE_TYPE &&
    typeof v.connectorInstanceId === "string" &&
    typeof v.accountInfo === "object" &&
    v.accountInfo !== null
  );
}

export function useGooglePopupAuthorize(
  options: UseGooglePopupAuthorizeOptions
): UseGooglePopupAuthorizeResult {
  const allowedOriginRef = useRef(options.allowedOrigin);
  useEffect(() => {
    allowedOriginRef.current = options.allowedOrigin;
  }, [options.allowedOrigin]);

  const start = useCallback((consentUrl: string) => {
    return new Promise<PopupAuthorizeResult>((resolve, reject) => {
      const popup = window.open(consentUrl, POPUP_NAME, POPUP_FEATURES);
      if (!popup) {
        reject(new Error("Failed to open OAuth popup (blocked?)"));
        return;
      }

      let settled = false;

      const cleanup = () => {
        window.removeEventListener("message", onMessage);
        clearInterval(pollHandle);
      };

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== allowedOriginRef.current) return;
        if (!isExpectedMessage(event.data)) return;
        settled = true;
        cleanup();
        try {
          popup.close();
        } catch {
          /* popup already closed by self-postMessage handler */
        }
        resolve({
          connectorInstanceId: event.data.connectorInstanceId,
          accountInfo: event.data.accountInfo,
        });
      };
      window.addEventListener("message", onMessage);

      const pollHandle = setInterval(() => {
        if (popup.closed && !settled) {
          settled = true;
          cleanup();
          reject(new PopupClosedError());
        }
      }, POPUP_POLL_INTERVAL_MS);
    });
  }, []);

  // Dummy state hook keeps React's strict-mode lint clean — the hook
  // is meaningfully a hook because it uses useEffect for ref sync.
  void useState;

  return { start };
}
