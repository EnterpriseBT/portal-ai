import { ApplicationRoute } from "../utils/routes.util";

describe("ApplicationRoute", () => {
  it("includes Help route at /help", () => {
    expect(ApplicationRoute.Help).toBe("/help");
  });
});
