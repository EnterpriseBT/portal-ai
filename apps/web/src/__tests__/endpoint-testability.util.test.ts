import { isTestableEndpointEntity } from "../utils/endpoint-testability.util";

const ids = new Set(["ent-1"]);

describe("isTestableEndpointEntity (#780)", () => {
  it("offers Test for an endpoint-backed entity on a REST API connector", () => {
    expect(
      isTestableEndpointEntity("ent-1", {
        isRestApi: true,
        endpointsFailed: false,
        endpointEntityIds: ids,
      })
    ).toBe(true);
  });

  it("doesn't offer it for an entity with no endpoint", () => {
    expect(
      isTestableEndpointEntity("ent-2", {
        isRestApi: true,
        endpointsFailed: false,
        endpointEntityIds: ids,
      })
    ).toBe(false);
  });

  it("offers it for every entity when the endpoint list failed", () => {
    expect(
      isTestableEndpointEntity("ent-2", {
        isRestApi: true,
        endpointsFailed: true,
        endpointEntityIds: new Set(),
      })
    ).toBe(true);
  });

  it("never offers it on another connector type", () => {
    expect(
      isTestableEndpointEntity("ent-1", {
        isRestApi: false,
        endpointsFailed: true,
        endpointEntityIds: ids,
      })
    ).toBe(false);
  });
});
