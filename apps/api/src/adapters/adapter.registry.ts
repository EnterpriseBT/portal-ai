import type { ConnectorAdapter } from "./adapter.interface.js";

/**
 * Maps connector definition slugs to their adapter implementations.
 *
 * Usage:
 *   ConnectorAdapterRegistry.register("sandbox", sandboxAdapter);
 *   const adapter = ConnectorAdapterRegistry.find("sandbox");
 *
 * There is deliberately no throwing lookup (#774). A missing adapter means a
 * connector type with no capabilities (file upload), and each caller decides
 * what that means for it: a request refuses with its own 4xx, the sync worker
 * fails the job without retrying. A plain `Error` thrown from here became a
 * 500 in a request path (#772).
 */
export class ConnectorAdapterRegistry {
  private static readonly adapters = new Map<string, ConnectorAdapter>();

  /** Register an adapter for a connector definition slug. */
  static register(slug: string, adapter: ConnectorAdapter): void {
    this.adapters.set(slug, adapter);
  }

  /**
   * Retrieve the adapter for a slug, returning `undefined` if none is
   * registered. An unregistered slug is a valid state: the connector type
   * has no adapter and so no capabilities.
   */
  static find(slug: string): ConnectorAdapter | undefined {
    return this.adapters.get(slug);
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
