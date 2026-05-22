import { describe, it, expect } from "@jest/globals";

import {
  EMPTY_CREDENTIALS_DRAFT,
  validateBasics,
  validateEndpoint,
  validateEndpointsList,
} from "../utils/rest-api-validation.util";

describe("validateBasics — common", () => {
  it("returns no errors for valid name + baseUrl + none auth", () => {
    const errors = validateBasics({
      name: "Acme API",
      baseUrl: "https://api.example.com",
      authMode: "none",
      credentials: EMPTY_CREDENTIALS_DRAFT,
    });
    expect(errors).toEqual({});
  });

  it("flags empty name", () => {
    const errors = validateBasics({
      name: "",
      baseUrl: "https://x.test",
      authMode: "none",
      credentials: EMPTY_CREDENTIALS_DRAFT,
    });
    expect(errors.name).toMatch(/required/i);
  });

  it("flags empty baseUrl", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "",
      authMode: "none",
      credentials: EMPTY_CREDENTIALS_DRAFT,
    });
    expect(errors.baseUrl).toMatch(/required/i);
  });

  it("flags invalid baseUrl", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "not-a-url",
      authMode: "none",
      credentials: EMPTY_CREDENTIALS_DRAFT,
    });
    expect(errors.baseUrl).toMatch(/valid URL/i);
  });
});

describe("validateBasics — apiKey mode", () => {
  it("flags missing keyName and value", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "https://x.test",
      authMode: "apiKey",
      credentials: EMPTY_CREDENTIALS_DRAFT,
    });
    expect(errors.keyName).toMatch(/required/i);
    expect(errors.value).toMatch(/required/i);
  });

  it("returns no credential errors when keyName and value are both populated", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "https://x.test",
      authMode: "apiKey",
      credentials: {
        ...EMPTY_CREDENTIALS_DRAFT,
        keyName: "X-API-Key",
        placement: "header",
        apiKeyValue: "secret",
      },
    });
    expect(errors.keyName).toBeUndefined();
    expect(errors.value).toBeUndefined();
  });
});

describe("validateBasics — bearer mode", () => {
  it("flags missing token", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "https://x.test",
      authMode: "bearer",
      credentials: EMPTY_CREDENTIALS_DRAFT,
    });
    expect(errors.token).toMatch(/required/i);
  });

  it("returns no token error when token is populated", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "https://x.test",
      authMode: "bearer",
      credentials: { ...EMPTY_CREDENTIALS_DRAFT, bearerToken: "tok" },
    });
    expect(errors.token).toBeUndefined();
  });
});

describe("validateBasics — basic mode", () => {
  it("flags missing username and password", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "https://x.test",
      authMode: "basic",
      credentials: EMPTY_CREDENTIALS_DRAFT,
    });
    expect(errors.username).toMatch(/required/i);
    expect(errors.password).toMatch(/required/i);
  });

  it("returns no credential errors when both fields are populated", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "https://x.test",
      authMode: "basic",
      credentials: {
        ...EMPTY_CREDENTIALS_DRAFT,
        basicUsername: "u",
        basicPassword: "p",
      },
    });
    expect(errors.username).toBeUndefined();
    expect(errors.password).toBeUndefined();
  });
});

describe("validateEndpoint", () => {
  it("returns no errors for a valid endpoint draft", () => {
    const errors = validateEndpoint({
      key: "users",
      label: "Users",
      path: "/users",
      method: "GET",
      recordsPath: "",
      idField: "id",
    });
    expect(errors).toEqual({});
  });

  it("flags empty key", () => {
    const errors = validateEndpoint({
      key: "",
      label: "X",
      path: "/x",
      method: "GET",
      recordsPath: "",
      idField: "",
    });
    expect(errors.key).toMatch(/required/i);
  });

  it("flags invalid method", () => {
    const errors = validateEndpoint({
      key: "x",
      label: "X",
      path: "/x",
      method: "PATCH",
      recordsPath: "",
      idField: "",
    });
    // method violation comes back from the Zod schema with the message
    // text mentioning the enum options.
    expect(Object.keys(errors)).toContain("method");
  });

  it("flags empty path", () => {
    const errors = validateEndpoint({
      key: "x",
      label: "X",
      path: "",
      method: "GET",
      recordsPath: "",
      idField: "",
    });
    expect(Object.keys(errors)).toContain("path");
  });
});

describe("validateEndpointsList", () => {
  it("requires at least one endpoint", () => {
    expect(validateEndpointsList([])).toEqual({
      endpoints: expect.stringMatching(/at least one/i),
    });
  });

  it("accepts non-empty list", () => {
    expect(validateEndpointsList([{ key: "x" }])).toEqual({});
  });
});
