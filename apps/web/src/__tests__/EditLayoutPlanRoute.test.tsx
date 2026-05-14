import { describe, it, expect } from "@jest/globals";

import { Route as EditLayoutPlanRoute } from "../routes/connectors.$connectorInstanceId.layout-plan.edit";
import { routeTree } from "../routeTree.gen";

describe("connectors.$connectorInstanceId.layout-plan.edit route", () => {
  it("exports a Route object built from createFileRoute", () => {
    // `createFileRoute(...)` returns a Route with a runtime `options`
    // bag carrying its file-route id. We assert via Object access to
    // sidestep the discriminated-union type signature (the option keys
    // present at the type level depend on which createFileRoute path
    // was taken).
    const options = EditLayoutPlanRoute.options as unknown as Record<
      string,
      unknown
    >;
    expect(options.path ?? options.id).toBe("/layout-plan/edit");
  });

  it("appears in the generated route tree nested under the connector-instance route", () => {
    // The route tree compiles to a deeply nested children object — the
    // route file path translates to the leaf
    // `{ id: "/layout-plan/edit", path: "/layout-plan/edit" }`
    // underneath the connector-instance parent. Stringify-grep is
    // sufficient: the generator's own conventions guarantee the route
    // id + path appear verbatim once registered.
    expect(JSON.stringify(routeTree)).toContain(
      `"id":"/layout-plan/edit","path":"/layout-plan/edit"`
    );
  });
});
