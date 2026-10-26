import {
  stashReturnTo,
  takeReturnTo,
} from "../utils/post-login-return-to.util";

const KEY = "test-return-to";

describe("pre-login return-to stash (#585, #884)", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("stashes an in-app path, single-use", () => {
    stashReturnTo(KEY, "/invitations/accept?token=t");
    expect(takeReturnTo(KEY)).toBe("/invitations/accept?token=t");
    expect(takeReturnTo(KEY)).toBeNull();
  });

  it("refuses anything that isn't an in-app path, incl. protocol-relative", () => {
    stashReturnTo(KEY, "https://evil.test/");
    stashReturnTo(KEY, "//evil.test/path");
    expect(takeReturnTo(KEY)).toBeNull();
  });
});
