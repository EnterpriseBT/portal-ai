import { describe, it, expect } from "@jest/globals";

import {
  validateBasics,
  validateEndpoint,
  validateEndpointsList,
} from "../utils/rest-api-validation.util";

describe("validateBasics", () => {
  it("returns no errors for valid input", () => {
    const errors = validateBasics({
      name: "Acme API",
      baseUrl: "https://api.example.com",
    });
    expect(errors).toEqual({});
  });

  it("flags empty name", () => {
    const errors = validateBasics({
      name: "",
      baseUrl: "https://x.test",
    });
    expect(errors.name).toMatch(/required/i);
  });

  it("flags empty baseUrl", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "",
    });
    expect(errors.baseUrl).toMatch(/required/i);
  });

  it("flags invalid baseUrl", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "not-a-url",
    });
    expect(errors.baseUrl).toMatch(/valid URL/i);
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
