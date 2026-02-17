import { v5 } from "uuid";
import {
  IDFactory,
  UUIDv4Factory,
  UUIDv5Factory,
} from "../utils/id-factory.js";

// ── Helpers ─────────────────────────────────────────────────────────

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TEST_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // DNS namespace

// ── Tests ───────────────────────────────────────────────────────────

describe("IDFactory", () => {
  it("is abstract and cannot be instantiated directly", () => {
    // @ts-expect-error — abstract class
    expect(() => new IDFactory()).toThrow();
  });
});

describe("UUIDv4Factory", () => {
  const factory = new UUIDv4Factory();

  it("extends IDFactory", () => {
    expect(factory).toBeInstanceOf(IDFactory);
  });

  it("generate() returns a valid UUID v4 string", () => {
    const id = factory.generate();
    expect(id).toMatch(UUID_REGEX);
  });

  it("generate() returns a unique value on each call", () => {
    const ids = new Set(Array.from({ length: 100 }, () => factory.generate()));
    expect(ids.size).toBe(100);
  });
});

describe("UUIDv5Factory", () => {
  const factory = new UUIDv5Factory(TEST_NAMESPACE);

  it("extends IDFactory", () => {
    expect(factory).toBeInstanceOf(IDFactory);
  });

  it("generate(name) returns a valid UUID string", () => {
    const id = factory.generate("hello");
    expect(id).toMatch(UUID_REGEX);
  });

  it("generate(name) is deterministic for the same name + namespace", () => {
    const a = factory.generate("test-input");
    const b = factory.generate("test-input");
    expect(a).toBe(b);
  });

  it("generate(name) matches the uuid library directly", () => {
    const name = "example.com";
    expect(factory.generate(name)).toBe(v5(name, TEST_NAMESPACE));
  });

  it("different names produce different UUIDs", () => {
    const a = factory.generate("alpha");
    const b = factory.generate("beta");
    expect(a).not.toBe(b);
  });

  it("generate() without a name still returns a valid UUID", () => {
    const id = factory.generate();
    expect(id).toMatch(UUID_REGEX);
  });

  it("generate() without a name returns unique values", () => {
    const ids = new Set(Array.from({ length: 50 }, () => factory.generate()));
    expect(ids.size).toBe(50);
  });
});
