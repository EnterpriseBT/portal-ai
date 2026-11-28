/**
 * #1079: the start box's history state readers, and the session mark that
 * answers an admitted first question when its portal opens later (#1137
 * adversarial walk: Back pressed mid-start).
 */
import { jest } from "@jest/globals";

import {
  PENDING_FIRST_TURN_TTL_MS,
  forgetPendingFirstTurn,
  hasPendingFirstTurn,
  readPendingInitialMessage,
  readRefusedInitialMessage,
  rememberPendingFirstTurn,
} from "../utils/portal-initial-message.util";

const KEY = "portalai-pending-first-turns";

beforeEach(() => sessionStorage.clear());

describe("history state readers", () => {
  it("reads a refused question only when it's shaped like one", () => {
    expect(
      readRefusedInitialMessage({
        refusedInitialMessage: { prompt: "Top accounts", message: "Limit" },
      })
    ).toEqual({ prompt: "Top accounts", message: "Limit" });
    expect(readRefusedInitialMessage(null)).toBeNull();
    expect(
      readRefusedInitialMessage({ refusedInitialMessage: { prompt: " " } })
    ).toBeNull();
  });

  it("reads a pending question only for `true`", () => {
    expect(readPendingInitialMessage({ pendingInitialMessage: true })).toBe(
      true
    );
    expect(readPendingInitialMessage({ pendingInitialMessage: "yes" })).toBe(
      false
    );
    expect(readPendingInitialMessage(undefined)).toBe(false);
  });
});

describe("pending first turn mark", () => {
  it("remembers a portal until it's forgotten", () => {
    rememberPendingFirstTurn("p-1");
    rememberPendingFirstTurn("p-2");
    expect(hasPendingFirstTurn("p-1")).toBe(true);
    forgetPendingFirstTurn("p-1");
    expect(hasPendingFirstTurn("p-1")).toBe(false);
    expect(hasPendingFirstTurn("p-2")).toBe(true);
  });

  it("expires a mark, and drops expired ones on the next write", () => {
    const then = 1_000_000;
    rememberPendingFirstTurn("old", then);
    expect(
      hasPendingFirstTurn("old", then + PENDING_FIRST_TURN_TTL_MS - 1)
    ).toBe(true);
    expect(hasPendingFirstTurn("old", then + PENDING_FIRST_TURN_TTL_MS)).toBe(
      false
    );
    rememberPendingFirstTurn("new", then + PENDING_FIRST_TURN_TTL_MS);
    expect(Object.keys(JSON.parse(sessionStorage.getItem(KEY)!))).toEqual([
      "new",
    ]);
  });

  it("reads unreadable storage as no marks, and overwrites it", () => {
    sessionStorage.setItem(KEY, "{not json");
    expect(hasPendingFirstTurn("p-1")).toBe(false);
    sessionStorage.setItem(KEY, JSON.stringify({ "p-1": "soon" }));
    expect(hasPendingFirstTurn("p-1")).toBe(false);
    rememberPendingFirstTurn("p-2");
    expect(hasPendingFirstTurn("p-2")).toBe(true);
  });

  it("never throws when storage is unavailable", () => {
    const spy = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const set = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(() => rememberPendingFirstTurn("p-1")).not.toThrow();
    expect(hasPendingFirstTurn("p-1")).toBe(false);
    expect(() => forgetPendingFirstTurn("p-1")).not.toThrow();
    spy.mockRestore();
    set.mockRestore();
  });
});
