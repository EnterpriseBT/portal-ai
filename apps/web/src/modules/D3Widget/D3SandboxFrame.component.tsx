import React, { useEffect, useRef, useState } from "react";

import { createSandboxBridge } from "./utils/bridge.util";
import { SANDBOX_SRCDOC } from "./utils/sandbox-srcdoc.util";

import type { SandboxBridge } from "./utils/bridge.util";
import type { ProgressiveBatch } from "./utils/progressive-rows.util";
import type { D3SandboxTheme } from "./utils/sandbox-theme.util";

/** Height before the frame reports its rendered content height. */
const INITIAL_FRAME_HEIGHT = 360;
const FALLBACK_FRAME_WIDTH = 640;

export interface D3SandboxFrameUIProps {
  /** Function-body render program (see d3-widget.contract.ts). */
  program: string;
  params?: Record<string, unknown>;
  theme: D3SandboxTheme;
  /** Ordered batches; new entries are forwarded to the frame as they land. */
  batches: ProgressiveBatch[];
  onRendered?: (event: { height: number; rowCount: number }) => void;
  onError: (event: { message: string }) => void;
}

/**
 * The sandboxed execution surface (#268): an `allow-scripts`-only iframe
 * hosting the shared no-egress srcdoc, wired to its bridge for the life
 * of the mount. The program is fixed per mount — a different program
 * warrants a fresh frame (remount), matching the bootstrap's accept-once
 * `init` contract.
 */
export const D3SandboxFrameUI: React.FC<D3SandboxFrameUIProps> = ({
  program,
  params,
  theme,
  batches,
  onRendered,
  onError,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<SandboxBridge | null>(null);
  const forwardedRef = useRef(0);
  const [frameHeight, setFrameHeight] = useState(INITIAL_FRAME_HEIGHT);

  // Callbacks/theme are read through refs so the bridge is created once
  // per mount and prop-identity churn can't re-init the frame.
  const callbacksRef = useRef({ onRendered, onError });
  callbacksRef.current = { onRendered, onError };
  const themeRef = useRef(theme);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const bridge = createSandboxBridge(
      iframe,
      {
        program,
        params,
        theme: themeRef.current,
        size: {
          width: iframe.parentElement?.clientWidth || FALLBACK_FRAME_WIDTH,
          height: INITIAL_FRAME_HEIGHT,
        },
      },
      {
        onRendered: (event) => {
          setFrameHeight(event.height || INITIAL_FRAME_HEIGHT);
          callbacksRef.current.onRendered?.(event);
        },
        onResize: (event) => {
          setFrameHeight(event.height || INITIAL_FRAME_HEIGHT);
        },
        onError: (event) => {
          callbacksRef.current.onError({ message: event.message });
        },
      }
    );
    bridgeRef.current = bridge;
    forwardedRef.current = 0;

    return () => {
      bridgeRef.current = null;
      bridge.dispose();
    };
    // program/params are fixed per mount by contract (see JSDoc).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Forward newly arrived batches (the bridge queues pre-ready sends).
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    for (let i = forwardedRef.current; i < batches.length; i++) {
      const batch = batches[i];
      bridge.sendData(batch.rows, batch.seq, batch.done);
    }
    forwardedRef.current = batches.length;
  }, [batches]);

  // Live theme switches re-render in place.
  useEffect(() => {
    if (theme !== themeRef.current) {
      themeRef.current = theme;
      bridgeRef.current?.sendTheme(theme);
    }
  }, [theme]);

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts"
      srcDoc={SANDBOX_SRCDOC}
      title="D3 visualization"
      style={{
        width: "100%",
        border: 0,
        display: "block",
        height: frameHeight,
      }}
    />
  );
};
