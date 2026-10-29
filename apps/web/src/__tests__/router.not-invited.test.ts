import { jest } from "@jest/globals";

import { createRootRoute } from "@tanstack/react-router";

// #916 review: the not-invited redirect is registered when the router module
// loads, so a refusal can never arrive before a handler exists (an effect in
// the root route left that window open). A bare route tree keeps the app's
// views out of this test.
jest.unstable_mockModule("../routeTree.gen", () => ({
  routeTree: createRootRoute(),
}));

const { router } = await import("../router");
const { handleNotInvited } = await import("../utils/auth-error.util");

describe("router not-invited redirect (#916)", () => {
  it("is registered at module load and replaces history with /not-invited", () => {
    const navigate = jest
      .spyOn(router, "navigate")
      .mockResolvedValue(undefined as never);

    handleNotInvited();

    expect(navigate).toHaveBeenCalledWith({
      to: "/not-invited",
      replace: true,
    });
  });

  // #916 review: every refused request raises this; once the caller is on
  // the page, a late one must not navigate again.
  it("does nothing when already on /not-invited", () => {
    const navigate = jest
      .spyOn(router, "navigate")
      .mockResolvedValue(undefined as never);
    navigate.mockClear();
    window.history.pushState({}, "", "/not-invited");

    try {
      handleNotInvited();
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      window.history.pushState({}, "", "/");
    }
  });
});
