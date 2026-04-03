import { describe, it, expect } from "@jest/globals";
import { resolveCapabilities } from "../../utils/resolve-capabilities.util.js";

describe("resolveCapabilities", () => {
  it("inherits all definition capabilities when enabledCapabilityFlags is null", () => {
    const definition = { capabilityFlags: { query: true, write: true } };
    const instance = { enabledCapabilityFlags: null };

    expect(resolveCapabilities(definition, instance)).toEqual({
      read: true,
      write: true,
    });
  });

  it("narrows write to false when instance disables it", () => {
    const definition = { capabilityFlags: { query: true, write: true } };
    const instance = { enabledCapabilityFlags: { write: false } };

    expect(resolveCapabilities(definition, instance)).toEqual({
      read: true,
      write: false,
    });
  });

  it("cannot exceed definition ceiling — instance cannot enable write if definition lacks it", () => {
    const definition = { capabilityFlags: { query: true, write: false } };
    const instance = { enabledCapabilityFlags: { write: true } };

    expect(resolveCapabilities(definition, instance)).toEqual({
      read: true,
      write: false,
    });
  });

  it("returns read false when definition has query false", () => {
    const definition = { capabilityFlags: { query: false } };
    const instance = { enabledCapabilityFlags: null };

    expect(resolveCapabilities(definition, instance)).toEqual({
      read: false,
      write: false,
    });
  });

  it("handles definition with no flags set (all undefined)", () => {
    const definition = { capabilityFlags: {} };
    const instance = { enabledCapabilityFlags: null };

    expect(resolveCapabilities(definition, instance)).toEqual({
      read: false,
      write: false,
    });
  });

  it("allows partial overrides — only read set, write inherits", () => {
    const definition = { capabilityFlags: { query: true, write: true } };
    const instance = { enabledCapabilityFlags: { read: true } };

    expect(resolveCapabilities(definition, instance)).toEqual({
      read: true,
      write: true,
    });
  });

  it("instance can disable read independently of write", () => {
    const definition = { capabilityFlags: { query: true, write: true } };
    const instance = { enabledCapabilityFlags: { read: false, write: true } };

    expect(resolveCapabilities(definition, instance)).toEqual({
      read: false,
      write: true,
    });
  });
});
