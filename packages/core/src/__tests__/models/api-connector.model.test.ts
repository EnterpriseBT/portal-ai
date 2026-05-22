import {
  ApiAuthConfigSchema,
  ApiCredentialsSchema,
  RestApiInstanceConfigSchema,
  ApiEndpointConfigSchema,
} from "../../models/api-connector.model.js";

describe("ApiAuthConfigSchema", () => {
  it("accepts the `none` mode", () => {
    const result = ApiAuthConfigSchema.safeParse({ mode: "none" });
    expect(result.success).toBe(true);
  });

  it("accepts apiKey mode with header placement", () => {
    const result = ApiAuthConfigSchema.safeParse({
      mode: "apiKey",
      keyName: "X-API-Key",
      placement: "header",
    });
    expect(result.success).toBe(true);
  });

  it("accepts apiKey mode with query placement", () => {
    const result = ApiAuthConfigSchema.safeParse({
      mode: "apiKey",
      keyName: "api_key",
      placement: "query",
    });
    expect(result.success).toBe(true);
  });

  it("rejects apiKey with empty keyName", () => {
    const result = ApiAuthConfigSchema.safeParse({
      mode: "apiKey",
      keyName: "",
      placement: "header",
    });
    expect(result.success).toBe(false);
  });

  it("rejects apiKey with invalid placement enum", () => {
    const result = ApiAuthConfigSchema.safeParse({
      mode: "apiKey",
      keyName: "X-API-Key",
      placement: "form",
    });
    expect(result.success).toBe(false);
  });

  it("accepts bearer mode", () => {
    const result = ApiAuthConfigSchema.safeParse({ mode: "bearer" });
    expect(result.success).toBe(true);
  });

  it("accepts basic mode", () => {
    const result = ApiAuthConfigSchema.safeParse({ mode: "basic" });
    expect(result.success).toBe(true);
  });

  it("rejects payloads with no mode", () => {
    const result = ApiAuthConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects unknown auth modes", () => {
    const result = ApiAuthConfigSchema.safeParse({ mode: "oauth2" });
    expect(result.success).toBe(false);
  });
});

describe("ApiCredentialsSchema", () => {
  it("accepts none mode", () => {
    const result = ApiCredentialsSchema.safeParse({ mode: "none" });
    expect(result.success).toBe(true);
  });

  it("accepts apiKey mode with a value", () => {
    const result = ApiCredentialsSchema.safeParse({
      mode: "apiKey",
      value: "abc",
    });
    expect(result.success).toBe(true);
  });

  it("rejects apiKey with empty value", () => {
    const result = ApiCredentialsSchema.safeParse({
      mode: "apiKey",
      value: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects apiKey without a value", () => {
    const result = ApiCredentialsSchema.safeParse({ mode: "apiKey" });
    expect(result.success).toBe(false);
  });

  it("accepts bearer mode with a token", () => {
    const result = ApiCredentialsSchema.safeParse({
      mode: "bearer",
      token: "tok",
    });
    expect(result.success).toBe(true);
  });

  it("rejects bearer with empty token", () => {
    const result = ApiCredentialsSchema.safeParse({
      mode: "bearer",
      token: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts basic mode with username + password", () => {
    const result = ApiCredentialsSchema.safeParse({
      mode: "basic",
      username: "u",
      password: "p",
    });
    expect(result.success).toBe(true);
  });

  it("rejects basic mode with empty username", () => {
    const result = ApiCredentialsSchema.safeParse({
      mode: "basic",
      username: "",
      password: "p",
    });
    expect(result.success).toBe(false);
  });

  it("rejects basic mode with empty password", () => {
    const result = ApiCredentialsSchema.safeParse({
      mode: "basic",
      username: "u",
      password: "",
    });
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

  it("accepts a valid base URL with apiKey auth", () => {
    const result = RestApiInstanceConfigSchema.safeParse({
      baseUrl: "https://api.example.com",
      auth: { mode: "apiKey", keyName: "X-API-Key", placement: "header" },
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
