import { describe, it, expect } from "@jest/globals";

import { tokenIssuer } from "../../utils/token-issuer.util.js";

// #950: the issuer every profile fetch must carry.
describe("tokenIssuer", () => {
  it("returns the token's iss claim", () => {
    const iss = "http://auth.portalai.localhost/realms/portalai";
    expect(tokenIssuer({ auth: { payload: { iss } } })).toBe(iss);
  });

  it("is undefined without a verified token or a string claim", () => {
    expect(tokenIssuer({})).toBeUndefined();
    expect(tokenIssuer({ auth: { payload: {} } })).toBeUndefined();
    expect(tokenIssuer({ auth: { payload: { iss: 42 } } })).toBeUndefined();
  });
});
