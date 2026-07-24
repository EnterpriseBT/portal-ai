import { z } from "zod";

import type { D3SandboxTheme } from "./sandbox-theme.util";

/**
 * Parent-side of the sandbox postMessage protocol (#268). The in-frame
 * counterpart is `sandbox-bootstrap.js` — keep the two in lockstep.
 *
 * Authenticity: an opaque-origin frame forces `targetOrigin: "*"`, so
 * inbound messages are validated by `event.source === iframe.contentWindow`
 * PLUS a per-instance nonce echoed in every post-init message (the
 * OAuth-popup validation pattern). `v` is the additive-evolution hook.
 */

export const BRIDGE_PROTOCOL_VERSION = 1 as const;

/** Watchdog: time from bridge creation to the first rendered/error. */
export const RENDER_TIMEOUT_MS = 10_000;

/**
 * Page size for progressive handle fetches — mirrors the handle service's
 * 1000-row Redis batch grain (alignment is an optimization, not a
 * correctness dependency).
 */
export const D3_SNAPSHOT_PAGE_SIZE = 1_000;

// ── Frame → parent messages ──────────────────────────────────────────

const versioned = z.object({
  v: z.literal(BRIDGE_PROTOCOL_VERSION),
  nonce: z.string(),
});

/** `ready` precedes init, so the frame doesn't know the nonce yet. */
const ReadyMessageSchema = z.object({
  v: z.literal(BRIDGE_PROTOCOL_VERSION),
  nonce: z.null(),
  type: z.literal("ready"),
});

const RenderedMessageSchema = versioned.extend({
  type: z.literal("rendered"),
  height: z.number(),
  rowCount: z.number(),
});

const ResizeMessageSchema = versioned.extend({
  type: z.literal("resize"),
  height: z.number(),
});

const ErrorMessageSchema = versioned.extend({
  type: z.literal("error"),
  message: z.string(),
  stack: z.string().optional(),
});

export const SandboxOutMessageSchema = z.discriminatedUnion("type", [
  ReadyMessageSchema,
  RenderedMessageSchema,
  ResizeMessageSchema,
  ErrorMessageSchema,
]);
export type SandboxOutMessage = z.infer<typeof SandboxOutMessageSchema>;

// ── Bridge surface ───────────────────────────────────────────────────

export interface SandboxBridgeInit {
  program: string;
  params?: Record<string, unknown>;
  theme: D3SandboxTheme;
  size: { width: number; height: number };
}

export interface SandboxBridgeCallbacks {
  onRendered(event: { height: number; rowCount: number }): void;
  onResize(event: { height: number }): void;
  onError(event: { message: string; stack?: string }): void;
}

export interface SandboxBridge {
  sendData(
    rows: Array<Record<string, unknown>>,
    seq: number,
    done: boolean
  ): void;
  sendTheme(theme: D3SandboxTheme): void;
  sendResize(size: { width: number; height: number }): void;
  dispose(): void;
}

const generateNonce = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

/**
 * Wire a mounted sandbox iframe. Sends `init` when the frame reports
 * `ready`; outbound sends issued earlier are queued and flushed after
 * init (postMessage is FIFO per source/target pair, so no acking).
 */
export function createSandboxBridge(
  iframe: HTMLIFrameElement,
  init: SandboxBridgeInit,
  callbacks: SandboxBridgeCallbacks
): SandboxBridge {
  const nonce = generateNonce();
  let disposed = false;
  let ready = false;
  let settled = false;
  const queued: Array<Record<string, unknown>> = [];

  const post = (message: Record<string, unknown>): void => {
    iframe.contentWindow?.postMessage(
      { v: BRIDGE_PROTOCOL_VERSION, nonce, ...message },
      "*"
    );
  };

  const send = (message: Record<string, unknown>): void => {
    if (disposed) return;
    if (!ready) {
      queued.push(message);
      return;
    }
    post(message);
  };

  const watchdog = setTimeout(() => {
    if (settled || disposed) return;
    settled = true;
    callbacks.onError({
      message: `Visualization did not render within ${RENDER_TIMEOUT_MS / 1000}s.`,
    });
  }, RENDER_TIMEOUT_MS);

  const onMessage = (event: MessageEvent): void => {
    if (disposed) return;
    if (!iframe.contentWindow || event.source !== iframe.contentWindow) return;
    const parsed = SandboxOutMessageSchema.safeParse(event.data);
    if (!parsed.success) return;
    const message = parsed.data;

    if (message.type === "ready") {
      if (ready) return;
      ready = true;
      post({
        type: "init",
        program: init.program,
        params: init.params ?? {},
        theme: init.theme,
        size: init.size,
      });
      for (const pending of queued.splice(0)) post(pending);
      return;
    }

    if (message.nonce !== nonce) return;

    switch (message.type) {
      case "rendered":
        settled = true;
        clearTimeout(watchdog);
        callbacks.onRendered({
          height: message.height,
          rowCount: message.rowCount,
        });
        break;
      case "resize":
        callbacks.onResize({ height: message.height });
        break;
      case "error":
        settled = true;
        clearTimeout(watchdog);
        callbacks.onError({
          message: message.message,
          ...(message.stack !== undefined ? { stack: message.stack } : {}),
        });
        break;
    }
  };

  window.addEventListener("message", onMessage);

  return {
    sendData: (rows, seq, done) => send({ type: "data", rows, seq, done }),
    sendTheme: (theme) => send({ type: "theme", theme }),
    sendResize: (size) => send({ type: "resize", size }),
    dispose: () => {
      disposed = true;
      clearTimeout(watchdog);
      window.removeEventListener("message", onMessage);
    },
  };
}
