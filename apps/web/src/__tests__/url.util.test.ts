import { buildSearchParams, buildUrl } from "../utils/url.util";

describe("buildSearchParams", () => {
  it("should convert string values", () => {
    const result = buildSearchParams({ category: "database" });
    expect(result).toBe("category=database");
  });

  it("should convert number values", () => {
    const result = buildSearchParams({ limit: 20, offset: 0 });
    expect(result).toBe("limit=20&offset=0");
  });

  it("should convert boolean values", () => {
    const result = buildSearchParams({ isActive: true });
    expect(result).toBe("isActive=true");
  });

  it("should handle mixed value types", () => {
    const result = buildSearchParams({
      search: "postgres",
      limit: 10,
      isActive: false,
    });
    expect(result).toBe("search=postgres&limit=10&isActive=false");
  });

  it("should encode special characters", () => {
    const result = buildSearchParams({ search: "a b&c" });
    expect(result).toBe("search=a+b%26c");
  });

  it("should return empty string for empty object", () => {
    const result = buildSearchParams({});
    expect(result).toBe("");
  });

  it("should skip undefined values", () => {
    const result = buildSearchParams({ category: "database", search: undefined });
    expect(result).toBe("category=database");
  });

  it("should skip null values", () => {
    const result = buildSearchParams({ category: null, limit: 10 });
    expect(result).toBe("limit=10");
  });

  it("should return empty string when all values are undefined or null", () => {
    const result = buildSearchParams({ category: undefined, search: null });
    expect(result).toBe("");
  });
});

describe("buildUrl", () => {
  it("should return base when no params provided", () => {
    const result = buildUrl("/api/connector-definitions");
    expect(result).toBe("/api/connector-definitions");
  });

  it("should return base when params is undefined", () => {
    const result = buildUrl("/api/connector-definitions", undefined);
    expect(result).toBe("/api/connector-definitions");
  });

  it("should append query string when params provided", () => {
    const result = buildUrl("/api/connector-definitions", {
      limit: 10,
      offset: 0,
    });
    expect(result).toBe("/api/connector-definitions?limit=10&offset=0");
  });

  it("should handle single param", () => {
    const result = buildUrl("/api/connector-definitions", {
      category: "database",
    });
    expect(result).toBe("/api/connector-definitions?category=database");
  });

  it("should handle mixed param types", () => {
    const result = buildUrl("/api/items", {
      search: "test",
      limit: 5,
      isActive: true,
    });
    expect(result).toBe("/api/items?search=test&limit=5&isActive=true");
  });

  it("should return base when all params are undefined or null", () => {
    const result = buildUrl("/api/items", { category: undefined, search: null });
    expect(result).toBe("/api/items");
  });

  it("should exclude undefined and null params from query string", () => {
    const result = buildUrl("/api/items", {
      category: "database",
      search: undefined,
      isActive: null,
      limit: 10,
    });
    expect(result).toBe("/api/items?category=database&limit=10");
  });
});
