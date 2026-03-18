import {
  describe,
  it,
  expect,
  beforeEach,
} from "@jest/globals";

import { ConnectorAdapterRegistry } from "../../adapters/adapter.registry.js";
import type {
  ConnectorAdapter,
  EntityDataQuery,
  EntityDataResult,
  SyncResult,
  DiscoveredEntity,
  DiscoveredColumn,
} from "../../adapters/adapter.interface.js";
import type { ConnectorInstance } from "@portalai/core/models";

// ── Helpers ─────────────────────────────────────────────────────────

function createStubAdapter(
  accessMode: ConnectorAdapter["accessMode"]
): ConnectorAdapter {
  return {
    accessMode,
    queryRows: async (
      _instance: ConnectorInstance,
      _query: EntityDataQuery
    ): Promise<EntityDataResult> => ({
      rows: [],
      total: 0,
      columns: [],
      source: "cache",
    }),
    syncEntity: async (
      _instance: ConnectorInstance,
      _entityKey: string
    ): Promise<SyncResult> => ({
      created: 0,
      updated: 0,
      unchanged: 0,
      errors: 0,
    }),
    discoverEntities: async (
      _instance: ConnectorInstance
    ): Promise<DiscoveredEntity[]> => [],
    discoverColumns: async (
      _instance: ConnectorInstance,
      _entityKey: string
    ): Promise<DiscoveredColumn[]> => [],
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("ConnectorAdapterRegistry", () => {
  beforeEach(() => {
    ConnectorAdapterRegistry.clear();
  });

  // ── get ──────────────────────────────────────────────────────────

  describe("get", () => {
    it("returns the correct adapter for a registered slug", () => {
      const csvAdapter = createStubAdapter("import");
      ConnectorAdapterRegistry.register("csv", csvAdapter);

      expect(ConnectorAdapterRegistry.get("csv")).toBe(csvAdapter);
    });

    it("returns different adapters for different slugs", () => {
      const csvAdapter = createStubAdapter("import");
      const airtableAdapter = createStubAdapter("hybrid");

      ConnectorAdapterRegistry.register("csv", csvAdapter);
      ConnectorAdapterRegistry.register("airtable", airtableAdapter);

      expect(ConnectorAdapterRegistry.get("csv")).toBe(csvAdapter);
      expect(ConnectorAdapterRegistry.get("airtable")).toBe(airtableAdapter);
    });

    it("throws for an unregistered slug", () => {
      expect(() => ConnectorAdapterRegistry.get("unknown")).toThrow(
        'No connector adapter registered for slug "unknown"'
      );
    });
  });

  // ── register ────────────────────────────────────────────────────

  describe("register", () => {
    it("overwrites a previously registered adapter for the same slug", () => {
      const first = createStubAdapter("import");
      const second = createStubAdapter("import");

      ConnectorAdapterRegistry.register("csv", first);
      ConnectorAdapterRegistry.register("csv", second);

      expect(ConnectorAdapterRegistry.get("csv")).toBe(second);
    });
  });

  // ── has ─────────────────────────────────────────────────────────

  describe("has", () => {
    it("returns true for a registered slug", () => {
      ConnectorAdapterRegistry.register("csv", createStubAdapter("import"));
      expect(ConnectorAdapterRegistry.has("csv")).toBe(true);
    });

    it("returns false for an unregistered slug", () => {
      expect(ConnectorAdapterRegistry.has("csv")).toBe(false);
    });
  });

  // ── slugs ───────────────────────────────────────────────────────

  describe("slugs", () => {
    it("returns all registered slugs", () => {
      ConnectorAdapterRegistry.register("csv", createStubAdapter("import"));
      ConnectorAdapterRegistry.register("airtable", createStubAdapter("hybrid"));
      ConnectorAdapterRegistry.register("hubspot", createStubAdapter("hybrid"));

      const slugs = ConnectorAdapterRegistry.slugs();
      expect(slugs).toHaveLength(3);
      expect(slugs).toContain("csv");
      expect(slugs).toContain("airtable");
      expect(slugs).toContain("hubspot");
    });

    it("returns empty array when nothing is registered", () => {
      expect(ConnectorAdapterRegistry.slugs()).toEqual([]);
    });
  });

  // ── clear ───────────────────────────────────────────────────────

  describe("clear", () => {
    it("removes all registrations", () => {
      ConnectorAdapterRegistry.register("csv", createStubAdapter("import"));
      ConnectorAdapterRegistry.register("airtable", createStubAdapter("hybrid"));

      ConnectorAdapterRegistry.clear();

      expect(ConnectorAdapterRegistry.has("csv")).toBe(false);
      expect(ConnectorAdapterRegistry.has("airtable")).toBe(false);
      expect(ConnectorAdapterRegistry.slugs()).toEqual([]);
    });
  });

  // ── accessMode validation ───────────────────────────────────────

  describe("accessMode", () => {
    it.each<[string, ConnectorAdapter["accessMode"]]>([
      ["csv", "import"],
      ["airtable", "hybrid"],
      ["realtime-api", "live"],
    ])(
      "adapter registered as %s exposes accessMode '%s'",
      (slug, mode) => {
        const adapter = createStubAdapter(mode);
        ConnectorAdapterRegistry.register(slug, adapter);
        expect(ConnectorAdapterRegistry.get(slug).accessMode).toBe(mode);
      }
    );
  });
});
