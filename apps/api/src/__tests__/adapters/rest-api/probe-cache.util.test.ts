import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

import { ProbeCache } from "../../../adapters/rest-api/probe-cache.util.js";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("ProbeCache", () => {
  it("get on a missing key returns null", () => {
    const cache = new ProbeCache<number>();
    expect(cache.get("nope")).toBeNull();
  });

  it("set then get within TTL returns the cached value", () => {
    const cache = new ProbeCache<string>(60_000);
    cache.set("k", "v");
    jest.advanceTimersByTime(30_000);
    expect(cache.get("k")).toBe("v");
  });

  it("set then get after TTL returns null", () => {
    const cache = new ProbeCache<string>(60_000);
    cache.set("k", "v");
    jest.advanceTimersByTime(60_001);
    expect(cache.get("k")).toBeNull();
  });

  it("custom TTL overrides the constructor default", () => {
    const cache = new ProbeCache<string>(60_000);
    cache.set("k", "v", 1_000);
    jest.advanceTimersByTime(1_001);
    expect(cache.get("k")).toBeNull();
  });

  it("invalidate makes a still-fresh entry return null", () => {
    const cache = new ProbeCache<string>(60_000);
    cache.set("k", "v");
    cache.invalidate("k");
    expect(cache.get("k")).toBeNull();
  });

  it("invalidate on a missing key is a no-op", () => {
    const cache = new ProbeCache<string>();
    expect(() => cache.invalidate("nope")).not.toThrow();
  });

  it("expired entries are pruned lazily on get (size shrinks)", () => {
    const cache = new ProbeCache<string>(60_000);
    cache.set("k", "v");
    expect(cache.size()).toBe(1);
    jest.advanceTimersByTime(60_001);
    expect(cache.get("k")).toBeNull();
    expect(cache.size()).toBe(0);
  });

  it("keys are independent", () => {
    const cache = new ProbeCache<string>();
    cache.set("a", "alpha");
    cache.set("b", "beta");
    expect(cache.get("a")).toBe("alpha");
    expect(cache.get("b")).toBe("beta");
    cache.invalidate("a");
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBe("beta");
  });
});
