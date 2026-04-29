import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";

import {
  useGooglePopupAuthorize,
  PopupClosedError,
} from "../google-sheets-popup.util";

const ALLOWED_ORIGIN = "http://localhost:3001";

interface FakePopupWindow {
  closed: boolean;
  close(): void;
}

let fakePopup: FakePopupWindow;
let openSpy: jest.SpiedFunction<typeof window.open>;
let dispatchMessage: (data: unknown, origin: string) => void;

beforeEach(() => {
  jest.useFakeTimers();
  fakePopup = {
    closed: false,
    close() {
      this.closed = true;
    },
  };
  openSpy = jest
    .spyOn(window, "open")
    .mockImplementation(() => fakePopup as unknown as Window);

  dispatchMessage = (data: unknown, origin: string) => {
    const event = new MessageEvent("message", { data, origin });
    window.dispatchEvent(event);
  };
});

afterEach(() => {
  openSpy.mockRestore();
  jest.useRealTimers();
});

describe("useGooglePopupAuthorize", () => {
  it("opens the consent URL synchronously inside the click handler", () => {
    const { result } = renderHook(() =>
      useGooglePopupAuthorize({ allowedOrigin: ALLOWED_ORIGIN })
    );
    let promise!: Promise<unknown>;
    act(() => {
      promise = result.current.start("https://accounts.google.com/o/oauth2/auth");
    });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/auth",
      expect.any(String),
      expect.any(String)
    );
    // resolve the promise so afterEach doesn't leak.
    act(() => {
      dispatchMessage(
        {
          type: "google-sheets-authorized",
          connectorInstanceId: "ci-1",
          accountInfo: { identity: "alice@example.com", metadata: {} },
        },
        ALLOWED_ORIGIN
      );
    });
    return promise;
  });

  it("resolves with the postMessage payload on the right origin + type", async () => {
    const { result } = renderHook(() =>
      useGooglePopupAuthorize({ allowedOrigin: ALLOWED_ORIGIN })
    );
    let resolved!: { connectorInstanceId: string; accountInfo: unknown };
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current
        .start("https://accounts.google.com/o/oauth2/auth")
        .then((v) => {
          resolved = v;
        });
    });
    act(() => {
      dispatchMessage(
        {
          type: "google-sheets-authorized",
          connectorInstanceId: "ci-1",
          accountInfo: { identity: "alice@example.com", metadata: {} },
        },
        ALLOWED_ORIGIN
      );
    });
    await pending;
    expect(resolved).toEqual({
      connectorInstanceId: "ci-1",
      accountInfo: { identity: "alice@example.com", metadata: {} },
    });
  });

  it("falls back to the redirect_uri's origin when allowedOrigin is empty/wildcard", async () => {
    const { result } = renderHook(() =>
      useGooglePopupAuthorize({ allowedOrigin: "" })
    );
    let resolved: { connectorInstanceId: string } | null = null;
    let pending!: Promise<unknown>;
    // Consent URL with redirect_uri pointing at the API origin.
    const consentUrl = `https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=${encodeURIComponent(
      "http://localhost:3001/api/connectors/google-sheets/callback"
    )}&client_id=x&response_type=code`;
    act(() => {
      pending = result.current.start(consentUrl).then((v) => {
        resolved = v;
      });
    });
    // Message from the redirect_uri's origin must be accepted, even
    // though `allowedOrigin: ""` was passed.
    act(() => {
      dispatchMessage(
        {
          type: "google-sheets-authorized",
          connectorInstanceId: "ci-fallback",
          accountInfo: { identity: null, metadata: {} },
        },
        "http://localhost:3001"
      );
    });
    await pending;
    expect(resolved).toEqual({
      connectorInstanceId: "ci-fallback",
      accountInfo: { identity: null, metadata: {} },
    });
  });

  it("ignores messages from the wrong origin (popup stays open)", () => {
    const { result } = renderHook(() =>
      useGooglePopupAuthorize({ allowedOrigin: ALLOWED_ORIGIN })
    );
    act(() => {
      void result.current.start("https://accounts.google.com/o/oauth2/auth");
    });
    act(() => {
      dispatchMessage(
        { type: "google-sheets-authorized", connectorInstanceId: "evil" },
        "https://evil.example.com"
      );
    });
    expect(fakePopup.closed).toBe(false);
  });

  it("ignores messages whose type doesn't match", () => {
    const { result } = renderHook(() =>
      useGooglePopupAuthorize({ allowedOrigin: ALLOWED_ORIGIN })
    );
    act(() => {
      void result.current.start("https://accounts.google.com/o/oauth2/auth");
    });
    act(() => {
      dispatchMessage(
        { type: "something-else", connectorInstanceId: "x" },
        ALLOWED_ORIGIN
      );
    });
    expect(fakePopup.closed).toBe(false);
  });

  it("rejects with PopupClosedError after the 5-minute timeout when no message arrives", async () => {
    const { result } = renderHook(() =>
      useGooglePopupAuthorize({ allowedOrigin: ALLOWED_ORIGIN })
    );
    let rejected: unknown;
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current
        .start("https://accounts.google.com/o/oauth2/auth")
        .catch((err) => {
          rejected = err;
        });
    });
    // Advance past the 5-minute popup timeout. We don't poll
    // popup.closed (Chrome lies about it under COOP) — only the
    // timeout can reject.
    act(() => {
      jest.advanceTimersByTime(5 * 60 * 1000 + 100);
    });
    await pending;
    expect(rejected).toBeInstanceOf(PopupClosedError);
  });

  it("removes the message listener on resolve (no leftover listeners catch a second flow)", async () => {
    const { result } = renderHook(() =>
      useGooglePopupAuthorize({ allowedOrigin: ALLOWED_ORIGIN })
    );

    // First start — resolve normally.
    let firstResolved: { connectorInstanceId: string } | null = null;
    let firstPending!: Promise<unknown>;
    act(() => {
      firstPending = result.current
        .start("https://accounts.google.com/o/oauth2/auth")
        .then((v) => {
          firstResolved = v;
        });
    });
    act(() => {
      dispatchMessage(
        {
          type: "google-sheets-authorized",
          connectorInstanceId: "ci-1",
          accountInfo: { identity: null, metadata: {} },
        },
        ALLOWED_ORIGIN
      );
    });
    await firstPending;
    expect(firstResolved).toEqual({
      connectorInstanceId: "ci-1",
      accountInfo: { identity: null, metadata: {} },
    });

    // Reset popup so the second flow starts clean.
    fakePopup = { closed: false, close() { this.closed = true; } };
    openSpy.mockReturnValue(fakePopup as unknown as Window);

    // Second start — a fresh listener picks up the second message.
    let secondResolved: { connectorInstanceId: string } | null = null;
    let secondPending!: Promise<unknown>;
    act(() => {
      secondPending = result.current
        .start("https://accounts.google.com/o/oauth2/auth")
        .then((v) => {
          secondResolved = v;
        });
    });
    act(() => {
      dispatchMessage(
        {
          type: "google-sheets-authorized",
          connectorInstanceId: "ci-2",
          accountInfo: { identity: null, metadata: {} },
        },
        ALLOWED_ORIGIN
      );
    });
    await secondPending;
    // Must be ci-2 — if a stale listener from the first flow is still
    // around, it would have re-resolved with ci-1 (or thrown).
    expect(secondResolved).toEqual({
      connectorInstanceId: "ci-2",
      accountInfo: { identity: null, metadata: {} },
    });
  });
});
