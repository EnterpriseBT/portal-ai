import { IDFactory, UUIDv4Factory } from "../../utils/id-factory.js";

// ── Helpers ─────────────────────────────────────────────────────────

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
