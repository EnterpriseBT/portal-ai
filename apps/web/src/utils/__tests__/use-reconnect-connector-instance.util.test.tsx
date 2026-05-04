import type React from "react";

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { act, renderHook } from "@testing-library/react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const googleAuthorizeMock = jest.fn(async () => ({
  url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=g",
}));
const microsoftAuthorizeMock = jest.fn(async () => ({
  url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=m",
}));
const popupStartMock = jest.fn(async () => ({
  connectorInstanceId: "ci-1",
  accountInfo: { identity: "alice@example.com", metadata: {} },
}));
let lastPopupOptions: { slug: string; allowedOrigin: string } | null = null;

jest.unstable_mockModule("../../api/sdk", () => ({
  sdk: {
    googleSheets: { authorize: () => ({ mutateAsync: googleAuthorizeMock }) },
    microsoftExcel: {
      authorize: () => ({ mutateAsync: microsoftAuthorizeMock }),
    },
  },
  queryKeys: {
    connectorInstances: {
      get: (id: string) => ["connectorInstances", "get", id],
    },
  },
}));

jest.unstable_mockModule("../oauth-popup.util", () => {
  class MockPopupClosedError extends Error {
    override readonly name = "PopupClosedError" as const;
  }
  return {
    PopupClosedError: MockPopupClosedError,
    useOAuthPopupAuthorize: (opts: {
      slug: string;
      allowedOrigin: string;
    }) => {
      lastPopupOptions = opts;
      return { start: popupStartMock };
    },
  };
});

jest.unstable_mockModule("../api-origin.util", () => ({
  apiOrigin: () => "http://localhost:3001",
}));

const { useReconnectConnectorInstance } = await import(
  "../use-reconnect-connector-instance.util"
);

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  googleAuthorizeMock.mockClear();
  microsoftAuthorizeMock.mockClear();
  popupStartMock.mockClear();
  lastPopupOptions = null;
});

describe("useReconnectConnectorInstance", () => {
  it("dispatches to sdk.googleSheets.authorize for slug=google-sheets", async () => {
    const { result } = renderHook(
      () => useReconnectConnectorInstance("ci-1", "google-sheets"),
      { wrapper }
    );

    await act(async () => {
      await result.current.onReconnect();
    });

    expect(googleAuthorizeMock).toHaveBeenCalledTimes(1);
    expect(microsoftAuthorizeMock).not.toHaveBeenCalled();
    expect(popupStartMock).toHaveBeenCalledWith(
      expect.stringContaining("accounts.google.com")
    );
    expect(lastPopupOptions?.slug).toBe("google-sheets");
  });

  it("dispatches to sdk.microsoftExcel.authorize for slug=microsoft-excel", async () => {
    const { result } = renderHook(
      () => useReconnectConnectorInstance("ci-1", "microsoft-excel"),
      { wrapper }
    );

    await act(async () => {
      await result.current.onReconnect();
    });

    expect(microsoftAuthorizeMock).toHaveBeenCalledTimes(1);
    expect(googleAuthorizeMock).not.toHaveBeenCalled();
    expect(popupStartMock).toHaveBeenCalledWith(
      expect.stringContaining("login.microsoftonline.com")
    );
    expect(lastPopupOptions?.slug).toBe("microsoft-excel");
  });

  it("surfaces an error message for an unknown slug (no silent fallback)", async () => {
    const { result } = renderHook(
      () => useReconnectConnectorInstance("ci-1", "sandbox"),
      { wrapper }
    );

    await act(async () => {
      await result.current.onReconnect();
    });

    expect(googleAuthorizeMock).not.toHaveBeenCalled();
    expect(microsoftAuthorizeMock).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toMatch(
      /Reconnect is not supported for connector slug "sandbox"/
    );
  });

  it("stays silent when the user dismisses the popup (PopupClosedError)", async () => {
    const { PopupClosedError } = await import("../oauth-popup.util");
    popupStartMock.mockRejectedValueOnce(new PopupClosedError());

    const { result } = renderHook(
      () => useReconnectConnectorInstance("ci-1", "microsoft-excel"),
      { wrapper }
    );

    await act(async () => {
      await result.current.onReconnect();
    });

    expect(result.current.errorMessage).toBeNull();
  });

  it("clears errorMessage on dismiss", async () => {
    popupStartMock.mockRejectedValueOnce(new Error("Oops"));

    const { result } = renderHook(
      () => useReconnectConnectorInstance("ci-1", "microsoft-excel"),
      { wrapper }
    );

    await act(async () => {
      await result.current.onReconnect();
    });
    expect(result.current.errorMessage).toBe("Oops");

    act(() => {
      result.current.onDismissError();
    });
    expect(result.current.errorMessage).toBeNull();
  });
});
