import {
  ApiAuthConfigSchema,
  RestApiInstanceConfigSchema,
  ApiEndpointConfigSchema,
} from "../../models/api-connector.model.js";

describe("ApiAuthConfigSchema", () => {
  it("accepts the `none` mode", () => {
    const result = ApiAuthConfigSchema.safeParse({ mode: "none" });
    expect(result.success).toBe(true);
  });

  it("rejects unknown auth modes (phase 2 widens these)", () => {
    const result = ApiAuthConfigSchema.safeParse({
      mode: "apiKey",
      keyName: "X-API-Key",
      placement: "header",
    });
    expect(result.success).toBe(false);
  });

  it("rejects payloads with no mode", () => {
    const result = ApiAuthConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("RestApiInstanceConfigSchema", () => {
  it("accepts a valid base URL with none auth", () => {
    const result = RestApiInstanceConfigSchema.safeParse({
      baseUrl: "https://api.example.com",
      auth: { mode: "none" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-URL baseUrl", () => {
    const result = RestApiInstanceConfigSchema.safeParse({
      baseUrl: "not-a-url",
      auth: { mode: "none" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects when auth is missing", () => {
    const result = RestApiInstanceConfigSchema.safeParse({
      baseUrl: "https://api.example.com",
    });
    expect(result.success).toBe(false);
  });
});

describe("ApiEndpointConfigSchema", () => {
  it("accepts a minimal GET endpoint and defaults recordsPath to ''", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "/users",
      method: "GET",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recordsPath).toBe("");
    }
  });

  it("accepts a fully-populated POST endpoint", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "/search",
      method: "POST",
      recordsPath: "data.results",
      idField: "id",
      headers: { "X-Tenant": "acme" },
      queryParams: { active: "true" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty path", () => {
    const result = ApiEndpointConfigSchema.safeParse({ path: "", method: "GET" });
    expect(result.success).toBe(false);
  });

  it("rejects methods other than GET / POST", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "/x",
      method: "PATCH",
    });
    expect(result.success).toBe(false);
  });

  it("allows idField to be null", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "/x",
      method: "GET",
      idField: null,
    });
    expect(result.success).toBe(true);
  });
});
