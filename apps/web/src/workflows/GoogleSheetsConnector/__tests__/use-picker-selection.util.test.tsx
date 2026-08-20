/**
 * The account-match guard (#408).
 *
 * A `drive.file` grant is made in the browser, against whichever Google
 * account the user authorizes in the popup — but the sync reads with the
 * refresh token this connector stored when it was connected. Authorize as
 * someone else and the grant lands on an account the server cannot use; the
 * symptom is a 404 at sync time, which reads as "the file is missing".
 *
 * So the guard runs *before* the Picker opens: hint the linked account,
 * then check the address the token actually came back with.
 */

import { jest } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react";

const requestBrowserTokenMock =
  jest.fn<
    (args: {
      clientId: string;
      loginHint: string | null;
    }) => Promise<{ accessToken: string; email: string }>
  >();

const openSheetPickerMock =
  jest.fn<
    (args: {
      oauthToken: string;
      developerKey: string;
      appId: string;
    }) => Promise<{ spreadsheetId: string; name: string } | null>
  >();

const isPickerConfiguredMock = jest.fn<() => boolean>();

jest.unstable_mockModule("../utils/google-picker.util", () => ({
  requestBrowserToken: requestBrowserTokenMock,
  openSheetPicker: openSheetPickerMock,
  loadPicker: jest.fn(async () => undefined),
  isPickerConfigured: isPickerConfiguredMock,
  PICKER_API_KEY: "AIzaKEY",
  PICKER_CLIENT_ID: "client-1.apps.googleusercontent.com",
  PICKER_APP_ID: "872674925548",
}));

const { usePickerSelection } =
  await import("../utils/use-picker-selection.util");

beforeEach(() => {
  requestBrowserTokenMock.mockReset();
  openSheetPickerMock.mockReset();
  isPickerConfiguredMock.mockReset();
  isPickerConfiguredMock.mockReturnValue(true);
  openSheetPickerMock.mockResolvedValue({
    spreadsheetId: "1abcXYZ",
    name: "Q3 Forecast",
  });
});

describe("usePickerSelection — the account-match guard", () => {
  it("opens the Picker when the authorized account is the linked one", async () => {
    requestBrowserTokenMock.mockResolvedValue({
      accessToken: "ya29.token",
      email: "alice@example.com",
    });
    const onPicked = jest.fn();

    const { result } = renderHook(() =>
      usePickerSelection({ linkedEmail: "alice@example.com", onPicked })
    );
    await act(async () => {
      result.current.openPicker();
    });

    await waitFor(() => expect(openSheetPickerMock).toHaveBeenCalledTimes(1));
    expect(result.current.accountMismatch).toBeNull();
    expect(onPicked).toHaveBeenCalledWith({
      spreadsheetId: "1abcXYZ",
      name: "Q3 Forecast",
    });
  });

  it("passes the linked address as the login hint", async () => {
    requestBrowserTokenMock.mockResolvedValue({
      accessToken: "ya29.token",
      email: "alice@example.com",
    });

    const { result } = renderHook(() =>
      usePickerSelection({
        linkedEmail: "alice@example.com",
        onPicked: jest.fn(),
      })
    );
    await act(async () => {
      result.current.openPicker();
    });

    await waitFor(() =>
      expect(requestBrowserTokenMock).toHaveBeenCalledWith(
        expect.objectContaining({ loginHint: "alice@example.com" })
      )
    );
  });

  it("never opens the Picker when a different account was authorized", async () => {
    requestBrowserTokenMock.mockResolvedValue({
      accessToken: "ya29.token",
      email: "bob@example.com",
    });
    const onPicked = jest.fn();

    const { result } = renderHook(() =>
      usePickerSelection({ linkedEmail: "alice@example.com", onPicked })
    );
    await act(async () => {
      result.current.openPicker();
    });

    await waitFor(() =>
      expect(result.current.accountMismatch).toEqual({
        expected: "alice@example.com",
        authorized: "bob@example.com",
      })
    );
    expect(openSheetPickerMock).not.toHaveBeenCalled();
    expect(onPicked).not.toHaveBeenCalled();
  });

  it("compares case-insensitively — Google echoes the address as stored", async () => {
    requestBrowserTokenMock.mockResolvedValue({
      accessToken: "ya29.token",
      email: "Alice@Example.com",
    });

    const { result } = renderHook(() =>
      usePickerSelection({
        linkedEmail: "alice@example.com",
        onPicked: jest.fn(),
      })
    );
    await act(async () => {
      result.current.openPicker();
    });

    await waitFor(() => expect(openSheetPickerMock).toHaveBeenCalledTimes(1));
    expect(result.current.accountMismatch).toBeNull();
  });

  it("fails open when no linked address is known", async () => {
    // Blocking here would break a working flow to prevent a maybe; an
    // undetected mismatch degrades to today's behavior, which the sync-side
    // retry and error path already handle.
    requestBrowserTokenMock.mockResolvedValue({
      accessToken: "ya29.token",
      email: "bob@example.com",
    });

    const { result } = renderHook(() =>
      usePickerSelection({ linkedEmail: null, onPicked: jest.fn() })
    );
    await act(async () => {
      result.current.openPicker();
    });

    await waitFor(() => expect(openSheetPickerMock).toHaveBeenCalledTimes(1));
    expect(result.current.accountMismatch).toBeNull();
  });

  it("clears a previous mismatch once the right account authorizes", async () => {
    requestBrowserTokenMock.mockResolvedValueOnce({
      accessToken: "ya29.token",
      email: "bob@example.com",
    });
    requestBrowserTokenMock.mockResolvedValueOnce({
      accessToken: "ya29.token",
      email: "alice@example.com",
    });

    const { result } = renderHook(() =>
      usePickerSelection({
        linkedEmail: "alice@example.com",
        onPicked: jest.fn(),
      })
    );

    await act(async () => {
      result.current.openPicker();
    });
    await waitFor(() => expect(result.current.accountMismatch).not.toBeNull());

    await act(async () => {
      result.current.openPicker();
    });
    await waitFor(() => expect(result.current.accountMismatch).toBeNull());
    expect(openSheetPickerMock).toHaveBeenCalledTimes(1);
  });
});

describe("usePickerSelection — availability", () => {
  it("reports the Picker unavailable when the build-time config is missing", () => {
    isPickerConfiguredMock.mockReturnValue(false);

    const { result } = renderHook(() =>
      usePickerSelection({ linkedEmail: null, onPicked: jest.fn() })
    );

    expect(result.current.pickerUnavailable).toBe(true);
  });

  it("reports it unavailable when the Google script will not load", async () => {
    requestBrowserTokenMock.mockRejectedValue(
      new Error("Google picker script failed to load: https://x")
    );

    const { result } = renderHook(() =>
      usePickerSelection({ linkedEmail: null, onPicked: jest.fn() })
    );
    await act(async () => {
      result.current.openPicker();
    });

    await waitFor(() => expect(result.current.pickerUnavailable).toBe(true));
  });

  it("stays available when the user simply closes the popup", async () => {
    // A cancelled authorization is a choice, not a fault — telling the user
    // the picker is broken would be a lie they cannot act on.
    requestBrowserTokenMock.mockRejectedValue(new Error("popup_closed"));

    const { result } = renderHook(() =>
      usePickerSelection({ linkedEmail: null, onPicked: jest.fn() })
    );
    await act(async () => {
      result.current.openPicker();
    });

    await waitFor(() => expect(result.current.pickerLoading).toBe(false));
    expect(result.current.pickerUnavailable).toBe(false);
  });

  it("does not call onPicked when the user cancels the Picker", async () => {
    requestBrowserTokenMock.mockResolvedValue({
      accessToken: "ya29.token",
      email: "alice@example.com",
    });
    openSheetPickerMock.mockResolvedValue(null);
    const onPicked = jest.fn();

    const { result } = renderHook(() =>
      usePickerSelection({ linkedEmail: "alice@example.com", onPicked })
    );
    await act(async () => {
      result.current.openPicker();
    });

    await waitFor(() => expect(result.current.pickerLoading).toBe(false));
    expect(onPicked).not.toHaveBeenCalled();
  });
});
