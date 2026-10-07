/**
 * #711: what the app shows for a server error. A permission refusal's message
 * names the permission ("You don't have permission to manage billing."), so a
 * denial shows it as is; the standard lead only stands in when it's empty.
 */
import {
  isPermissionDenied,
  PERMISSION_DENIED_MESSAGE,
  serverErrorMessage,
} from "../utils/permission-denied.util";
import { INTERNAL_ERROR_MESSAGE } from "@portalai/core/constants";

describe("serverErrorMessage (#711)", () => {
  it("shows a denial's own message, which names the permission", () => {
    expect(
      serverErrorMessage({
        code: "PERMISSION_DENIED",
        message: "You don't have permission to manage billing.",
      })
    ).toBe("You don't have permission to manage billing.");
  });

  it("falls back to the standard lead for a denial with no message", () => {
    expect(serverErrorMessage({ code: "PERMISSION_DENIED", message: "" })).toBe(
      PERMISSION_DENIED_MESSAGE
    );
    expect(
      serverErrorMessage({ code: "PERMISSION_DENIED", message: "   " })
    ).toBe(PERMISSION_DENIED_MESSAGE);
  });

  it("shows any other error's message", () => {
    expect(
      serverErrorMessage({
        code: "ENTITY_TAG_DUPLICATE_NAME",
        message: "Taken",
      })
    ).toBe("Taken");
    expect(serverErrorMessage(new Error("Network down"))).toBe("Network down");
  });

  it("uses the fallback when there's nothing to show", () => {
    expect(serverErrorMessage(null, "Failed to revoke")).toBe(
      "Failed to revoke"
    );
    expect(serverErrorMessage(undefined)).toBe("Something went wrong.");
    expect(serverErrorMessage("boom", "Failed")).toBe("Failed");
    expect(serverErrorMessage({ message: "" }, "Failed")).toBe("Failed");
  });

  // #687: the API answers every 500 with the same generic message, so it
  // says nothing the call site's own fallback doesn't say better.
  it("uses the fallback for the API's generic 500 message", () => {
    expect(
      serverErrorMessage(
        { message: INTERNAL_ERROR_MESSAGE, code: "STATION_DELETE_FAILED" },
        "Couldn't delete the station."
      )
    ).toBe("Couldn't delete the station.");
  });

  it("recognises only PERMISSION_DENIED as a denial", () => {
    expect(isPermissionDenied("PERMISSION_DENIED")).toBe(true);
    expect(isPermissionDenied("INSUFFICIENT_ROLE")).toBe(false);
  });
});
