import type { ConnectorAdapter } from "./adapter.interface.js";

/**
 * Maps connector definition slugs to their adapter implementations.
 *
 * Usage:
 *   ConnectorAdapterRegistry.register("csv", csvAdapter);
 *   const adapter = ConnectorAdapterRegistry.get("csv");
 */
export class ConnectorAdapterRegistry {
  private static readonly adapters = new Map<string, ConnectorAdapter>();

  /** Register an adapter for a connector definition slug. */
  static register(slug: string, adapter: ConnectorAdapter): void {
    this.adapters.set(slug, adapter);
  }

  /** Retrieve the adapter for a connector definition slug. Throws if not found. */
  static get(slug: string): ConnectorAdapter {
    const adapter = this.adapters.get(slug);
    if (!adapter) {
      throw new Error(
        `No connector adapter registered for slug "${slug}"`
      );
    }
    return adapter;
  }

  /** Check whether an adapter is registered for the given slug. */
  static has(slug: string): boolean {
    return this.adapters.has(slug);
  }

  /** Return all registered slugs. */
  static slugs(): string[] {
    return [...this.adapters.keys()];
  }

  /** Remove all registrations (useful for testing). */
  static clear(): void {
    this.adapters.clear();
  }
}
