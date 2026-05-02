/**
 * Slug-parameterized OAuth popup handshake hook.
 *
 * Opens a popup pointed at a connector's OAuth consent URL, listens for
 * the `<slug>-authorized` postMessage that the API's callback HTML
 * emits, resolves with `{ connectorInstanceId, accountInfo }`. Origin-
 * locked to the allowed origin (the API host) so a malicious page can't
 * postMessage a forged payload.
 *
 * The window.open call MUST run synchronously inside the user's click
 * handler — browsers block popups opened in async continuations.
 *
 * **Why no popup-closed polling.** When the popup navigates to a page
 * with a stricter `Cross-Origin-Opener-Policy` (Google's consent screen
 * uses `same-origin`; Microsoft's similarly restricts), Chrome severs
 * the opener↔popup reference. The browser then **lies** to the opener:
 * `popup.closed` reads as `true` even while the popup is open. Polling
 * that property and rejecting on `closed === true` triggers a false
 * "popup was closed" error within milliseconds of opening.
 *
 * Therefore the postMessage is the only success signal. To handle the
 * "user actually closed without completing" case, a 5-minute timeout
 * (matching the OAuth state-token TTL) rejects the promise so callers
 * don't sit in a "connecting" state indefinitely.
 */

import { useCallback, useEffect, useRef } from "react";

import type { PublicAccountInfo } from "@portalai/core/contracts";

const POPUP_FEATURES = "width=520,height=640,menubar=no,toolbar=no,location=yes";
const POPUP_TIMEOUT_MS = 5 * 60 * 1000;

export interface PopupAuthorizeResult {
  connectorInstanceId: string;
  accountInfo: PublicAccountInfo;
}

export class PopupClosedError extends Error {
  override readonly name = "PopupClosedError" as const;
  constructor(message = "Authorization timed out — please try again") {
    super(message);
  }
}

export interface UseOAuthPopupAuthorizeOptions {
  /**
   * Connector slug — drives both the popup's window name
   * (`${slug}-oauth`) and the expected postMessage `type`
   * (`${slug}-authorized`). Must match the slug the API's callback HTML
   * was rendered with.
   */
  slug: string;
  /**
   * Origin allowlist for the postMessage `event.origin` check. Either:
   *
   *   - A specific origin string (e.g. `"https://api-dev.portalsai.io"`)
   *     — strict match, recommended for prod.
   *   - `"*"` or empty — fall back to the redirect URI's origin extracted
   *     from the consent URL passed to `start()`. The redirect URI is
   *     where the IdP sends the popup, so its origin is exactly the
   *     origin the postMessage will arrive from.
   */
  allowedOrigin: string;
}

export interface UseOAuthPopupAuthorizeResult {
  /**
   * Open the popup and return a promise that resolves with the
   * authorize payload, or rejects with `PopupClosedError` after the
   * 5-minute timeout if no postMessage arrives.
   */
  start: (consentUrl: string) => Promise<PopupAuthorizeResult>;
}

interface ExpectedMessage {
  type: string;
  connectorInstanceId: string;
  accountInfo: PublicAccountInfo;
}

function buildIsExpectedMessage(messageType: string) {
  return function isExpectedMessage(value: unknown): value is ExpectedMessage {
    if (typeof value !== "object" || value === null) return false;
    const v = value as Record<string, unknown>;
    return (
      v.type === messageType &&
      typeof v.connectorInstanceId === "string" &&
      typeof v.accountInfo === "object" &&
      v.accountInfo !== null
    );
  };
}

export function useOAuthPopupAuthorize(
  options: UseOAuthPopupAuthorizeOptions
): UseOAuthPopupAuthorizeResult {
  const allowedOriginRef = useRef(options.allowedOrigin);
  const slugRef = useRef(options.slug);
  useEffect(() => {
    allowedOriginRef.current = options.allowedOrigin;
    slugRef.current = options.slug;
  }, [options.allowedOrigin, options.slug]);

  const start = useCallback((consentUrl: string) => {
    return new Promise<PopupAuthorizeResult>((resolve, reject) => {
      const slug = slugRef.current;
      if (!slug) {
        reject(new Error("useOAuthPopupAuthorize: slug is required"));
        return;
      }
      const popupName = `${slug}-oauth`;
      const messageType = `${slug}-authorized`;
      const isExpectedMessage = buildIsExpectedMessage(messageType);

      const popup = window.open(consentUrl, popupName, POPUP_FEATURES);
      if (!popup) {
        reject(new Error("Failed to open OAuth popup (blocked?)"));
        return;
      }

      const configured = allowedOriginRef.current;
      let acceptOrigin = configured;
      if (!configured || configured === "*") {
        try {
          const consent = new URL(consentUrl);
          const redirect = consent.searchParams.get("redirect_uri");
          if (redirect) acceptOrigin = new URL(redirect).origin;
        } catch {
          /* leave acceptOrigin as-is; messages will be dropped */
        }
      }

      let settled = false;

      const cleanup = () => {
        window.removeEventListener("message", onMessage);
        clearTimeout(timeoutHandle);
      };

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== acceptOrigin) return;
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

      const timeoutHandle = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new PopupClosedError());
      }, POPUP_TIMEOUT_MS);
    });
  }, []);

  return { start };
}
