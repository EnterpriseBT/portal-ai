import { jest } from "@jest/globals";

/**
 * Capturable `EventSource` stub for tests that need to drive SSE handlers.
 *
 * jsdom provides no `EventSource`, and a no-op stub only proves a consumer
 * doesn't crash. This records the listeners a consumer registers so a test can
 * emit named events at it — needed for anything asserting on stream behavior
 * (#279: the portal stream's tool-step lifecycle).
 */
export type ESListener = (event: MessageEvent) => void;

export class MockEventSource {
  static instances: MockEventSource[] = [];
  static lastInstance: MockEventSource | null = null;

  url: string;
  close: jest.Mock;
  onerror: ((event: Event) => void) | null = null;

  private _listeners = new Map<string, ESListener[]>();

  constructor(url: string) {
    this.url = url;
    this.close = jest.fn();
    MockEventSource.instances.push(this);
    MockEventSource.lastInstance = this;
  }

  addEventListener(type: string, listener: ESListener) {
    const list = this._listeners.get(type) || [];
    list.push(listener);
    this._listeners.set(type, list);
  }

  removeEventListener(type: string, listener: ESListener) {
    const list = this._listeners.get(type) || [];
    this._listeners.set(
      type,
      list.filter((l) => l !== listener)
    );
  }

  // --- Test helpers ---

  /** Dispatch a named SSE event carrying `data` as JSON. */
  __emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    this._listeners.get(type)?.forEach((fn) => fn(event));
  }

  __emitError() {
    this.onerror?.(new Event("error"));
  }

  /**
   * The most recent connection whose URL contains `fragment`. A view can hold
   * several streams open at once (a portal session runs both the response
   * stream and the chat-lock job stream), so tests pick the one they mean
   * rather than trusting `lastInstance`.
   */
  static findByUrl(fragment: string): MockEventSource | undefined {
    return [...MockEventSource.instances]
      .reverse()
      .find((es) => es.url.includes(fragment));
  }

  static reset() {
    MockEventSource.instances = [];
    MockEventSource.lastInstance = null;
  }
}

/** Install the stub as the global `EventSource`. */
export const installMockEventSource = () => {
  Object.defineProperty(globalThis, "EventSource", {
    value: MockEventSource,
    writable: true,
    configurable: true,
  });
};
