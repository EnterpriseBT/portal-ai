import {
  peekReturnTo,
  stashReturnTo,
  takeReturnTo,
} from "../utils/post-login-return-to.util";

const KEY = "test-return-to";

describe("post-login return-to stash (#585, #884)", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("stashes an in-app path", () => {
    stashReturnTo(KEY, "/invitations/accept?token=t");
    expect(peekReturnTo(KEY)).toBe("/invitations/accept?token=t");
  });

  // #884: Authorized re-ran its stash during the redirect to /login and
  // overwrote the accept link with the login page.
  it("never stashes the login page, keeping the earlier target", () => {
    stashReturnTo(KEY, "/invitations/accept?token=t");
    stashReturnTo(KEY, "/login?token=t&qa=1");
    stashReturnTo(KEY, "/login");
    expect(peekReturnTo(KEY)).toBe("/invitations/accept?token=t");
  });

  it("still refuses anything that isn't an in-app path", () => {
    stashReturnTo(KEY, "https://evil.test/");
    stashReturnTo(KEY, "//evil.test/path");
    expect(peekReturnTo(KEY)).toBeNull();
  });

  it("peek leaves the value; take consumes it", () => {
    stashReturnTo(KEY, "/stations");
    expect(peekReturnTo(KEY)).toBe("/stations");
    expect(takeReturnTo(KEY)).toBe("/stations");
    expect(peekReturnTo(KEY)).toBeNull();
  });
});
