import React, { useEffect, useRef, useState } from "react";

import { createSandboxBridge } from "./utils/bridge.util";
import { rafCoalesce } from "./utils/raf-coalesce.util";
import { SANDBOX_SRCDOC } from "./utils/sandbox-srcdoc.util";
import {
  FALLBACK_FRAME_WIDTH,
  resolveFrameSize,
} from "./utils/widget-sizing.util";

import type { SandboxBridge } from "./utils/bridge.util";
import type { ProgressiveBatch } from "./utils/progressive-rows.util";
import type { D3SandboxTheme } from "./utils/sandbox-theme.util";
import type { FrameSize } from "./utils/widget-sizing.util";

/** Height before the frame reports its rendered content height. */
const INITIAL_FRAME_HEIGHT = 360;

export interface D3SandboxFrameUIProps {
  /** Function-body render program (see d3-widget.contract.ts). */
  program: string;
  params?: Record<string, unknown>;
  theme: D3SandboxTheme;
  /** Ordered batches; new entries are forwarded to the frame as they land. */
  batches: ProgressiveBatch[];
  /** `width` is the painted content width when the frame measured one (#278). */
  onRendered?: (event: {
    height: number;
    rowCount: number;
    width?: number;
  }) => void;
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
  const [frameSize, setFrameSize] = useState<FrameSize>({
    width: 0,
    height: INITIAL_FRAME_HEIGHT,
  });

  /**
   * The host's available width, read from the wrapper — never from the
   * iframe (#278). The iframe sits *inside* the wrapper and so cannot widen
   * it, which is what stops a grown frame from feeding back into a wider
   * available width and ratcheting.
   */
  const containerWidthRef = useRef(FALLBACK_FRAME_WIDTH);

  /** Last painted extent reported by the frame, re-used on container resize. */
  const extentRef = useRef<{ width?: number; height?: number }>({});

  // Callbacks/theme are read through refs so the bridge is created once
  // per mount and prop-identity churn can't re-init the frame.
  const callbacksRef = useRef({ onRendered, onError });
  callbacksRef.current = { onRendered, onError };
  const themeRef = useRef(theme);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    containerWidthRef.current =
      iframe.parentElement?.clientWidth || FALLBACK_FRAME_WIDTH;

    /** Painted extent in, frame box out — the shared sizing rule. */
    const resize = (): void => {
      setFrameSize(
        resolveFrameSize({
          contentWidth: extentRef.current.width,
          contentHeight: extentRef.current.height,
          containerWidth: containerWidthRef.current,
          fallbackHeight: INITIAL_FRAME_HEIGHT,
        })
      );
    };

    const applySize = (event: { height: number; width?: number }): void => {
      extentRef.current = { width: event.width, height: event.height };
      resize();
    };

    const bridge = createSandboxBridge(
      iframe,
      {
        program,
        params,
        theme: themeRef.current,
        size: {
          width: containerWidthRef.current,
          height: INITIAL_FRAME_HEIGHT,
        },
      },
      {
        onRendered: (event) => {
          applySize(event);
          callbacksRef.current.onRendered?.(event);
        },
        onResize: applySize,
        onError: (event) => {
          callbacksRef.current.onError({ message: event.message });
        },
      }
    );
    bridgeRef.current = bridge;
    forwardedRef.current = 0;

    /**
     * Keep the program's available width live for the life of the mount
     * (#278). Coalesced to one send per frame because reflow is bursty.
     *
     * The suggested height stays `INITIAL_FRAME_HEIGHT` forever, never the
     * painted height: echoing the painted height back would make the program
     * size to it, paint slightly past it, and grow again — a ratchet.
     */
    const sendAvailableWidth = rafCoalesce<number>((width) => {
      containerWidthRef.current = width;
      resize();
      bridgeRef.current?.sendResize({
        width,
        height: INITIAL_FRAME_HEIGHT,
      });
    });

    // The WRAPPER is observed, never the iframe: the iframe is inside it and
    // so cannot widen it, which is what closes the growth feedback loop.
    const wrapper = iframe.parentElement;
    const observer =
      wrapper && typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            sendAvailableWidth(wrapper.clientWidth || FALLBACK_FRAME_WIDTH);
          })
        : null;
    observer?.observe(wrapper as Element);

    return () => {
      bridgeRef.current = null;
      sendAvailableWidth.cancel();
      observer?.disconnect();
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
        // Painted width when the content is wider than the column (making the
        // host's overflowX wrapper a real scroller), never narrower than it.
        // No maxHeight and no overflow: the frame fits its visualization and
        // never scrolls (#278).
        width: frameSize.width || "100%",
        minWidth: "100%",
        border: 0,
        display: "block",
        height: frameSize.height,
      }}
    />
  );
};
