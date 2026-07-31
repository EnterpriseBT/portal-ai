import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import {
  Box,
  Stack,
  Button,
  IconButton,
  IconName,
  Icon,
} from "@portalai/core/ui";
import { IconButton as MuiIconButton, TextField, Tooltip } from "@mui/material";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { useLayout } from "../utils/layout.util";
import { ScrollRootContext } from "../utils/scroll-root.context";

// Px threshold within which the feed is treated as already "at the top/bottom";
// jump buttons hide inside this window to avoid nagging the user.
const JUMP_THRESHOLD_PX = 80;

/** Placeholder shown in the chat input. Exported so tests and other callers
 *  can reference the exact string without duplicating it. */
export const CHAT_INPUT_PLACEHOLDER =
  "Ask a question, visualize your data, or request a change…";

export interface ChatWindowHandle {
  clear: () => void;
  scrollToBottom: () => void;
  scrollToMessage: (messageId: string) => boolean;
}

export interface ChatWindowUIProps {
  onSubmit: (message: string) => void;
  onReset: () => void;
  onCancel: () => void;
  onExit: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
  /**
   * Transient status pinned just above the composer (#279 — the tool activity
   * strip). Rendered as an **overlay** inside the scroll region, so it
   * occupies no layout space: a row that appeared mid-turn would move the text
   * input under a user who may be typing and re-measure the feed's scroll
   * viewport while the auto-scroll effect is running.
   */
  statusStrip?: React.ReactNode;
}

export const ChatWindowUI = forwardRef<ChatWindowHandle, ChatWindowUIProps>(
  (
    { onSubmit, onReset, onCancel, onExit, disabled, children, statusStrip },
    ref
  ) => {
    const { isMobile } = useLayout();
    const [value, setValue] = useState("");
    const [showJumpTop, setShowJumpTop] = useState(false);
    const [showJumpBottom, setShowJumpBottom] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    // #271: expose the scroll container to descendants (viz widgets use it as
    // their IntersectionObserver root). State-backed so the context updates
    // once the node attaches; keeps `scrollRef.current` in sync for the
    // existing scroll/ResizeObserver logic.
    const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
    const setScrollNode = useCallback((node: HTMLDivElement | null) => {
      scrollRef.current = node;
      setScrollEl(node);
    }, []);
    // Track the active "stick-to-bottom" window so async content (charts, markdown)
    // that grows the container after the initial scroll still lands us at the
    // true bottom. Cleared when the window expires or the user scrolls manually.
    const stickToBottomRef = useRef(false);

    // Smooth scroll with a fallback for environments (e.g. jsdom) that don't
    // implement Element.scrollTo.
    const smoothScrollTop = (el: HTMLElement, top: number) => {
      if (typeof el.scrollTo === "function") {
        el.scrollTo({ top, behavior: "smooth" });
      } else {
        el.scrollTop = top;
      }
    };

    const scrollToBottomImpl = useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      smoothScrollTop(el, el.scrollHeight);

      // Re-pin to bottom while content is still settling (e.g. charts rendering).
      // Only re-scroll when scrollHeight actually *grew*, and use smooth too —
      // otherwise the observer's initial fire would instantly snap to the
      // bottom and kill the in-flight smooth animation.
      if (typeof ResizeObserver === "undefined") return;
      stickToBottomRef.current = true;
      let lastHeight = el.scrollHeight;
      const observer = new ResizeObserver(() => {
        if (!stickToBottomRef.current) return;
        const node = scrollRef.current;
        if (!node) return;
        if (node.scrollHeight <= lastHeight) return;
        lastHeight = node.scrollHeight;
        smoothScrollTop(node, node.scrollHeight);
      });
      observer.observe(el);
      for (const child of Array.from(el.children)) observer.observe(child);
      window.setTimeout(() => {
        stickToBottomRef.current = false;
        observer.disconnect();
      }, 1000);
    }, []);

    const scrollToTopImpl = useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      stickToBottomRef.current = false;
      smoothScrollTop(el, 0);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        clear: () => setValue(""),
        scrollToBottom: scrollToBottomImpl,
        scrollToMessage: (messageId: string) => {
          const container = scrollRef.current;
          if (!container) return false;
          const target = container.querySelector<HTMLElement>(
            `[data-message-id="${CSS.escape(messageId)}"]`
          );
          if (!target) return false;
          smoothScrollTop(container, target.offsetTop - container.offsetTop);
          return true;
        },
      }),
      [scrollToBottomImpl]
    );

    // Recalculate whether the jump-to-top/bottom buttons should be visible.
    // Hidden when the feed isn't overflowing or the user is already at that edge.
    const updateJumpButtons = useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      const canScroll = el.scrollHeight > el.clientHeight + JUMP_THRESHOLD_PX;
      const atTop = el.scrollTop <= JUMP_THRESHOLD_PX;
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight <= JUMP_THRESHOLD_PX;
      setShowJumpTop(canScroll && !atTop);
      setShowJumpBottom(canScroll && !atBottom);
    }, []);

    // Watch size changes too — buttons should appear as soon as content grows
    // past the viewport, not just on scroll. ResizeObserver fires once on
    // observe() with the current size, which doubles as our initial
    // measurement — so we don't need a synchronous setState in the effect body.
    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      if (typeof ResizeObserver === "undefined") {
        const id = requestAnimationFrame(() => updateJumpButtons());
        return () => cancelAnimationFrame(id);
      }
      const observer = new ResizeObserver(() => updateJumpButtons());
      observer.observe(el);
      for (const child of Array.from(el.children)) observer.observe(child);
      return () => observer.disconnect();
    }, [updateJumpButtons, children]);

    // Break the stick-to-bottom window the moment the user scrolls manually so
    // we don't fight their intent.
    const handleWheel = () => {
      stickToBottomRef.current = false;
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    };

    const handleSubmit = () => {
      onSubmit(value);
    };

    return (
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <Box sx={{ position: "relative", flex: 1, minHeight: 0, minWidth: 0 }}>
          <Box
            ref={setScrollNode}
            onScroll={updateJumpButtons}
            onWheel={handleWheel}
            onTouchMove={handleWheel}
            sx={{ height: "100%", overflow: "auto", p: 4 }}
          >
            <ScrollRootContext.Provider value={scrollEl}>
              {children}
            </ScrollRootContext.Provider>
          </Box>
          {showJumpTop && (
            <Tooltip title="Jump to top">
              <MuiIconButton
                size="small"
                onClick={scrollToTopImpl}
                aria-label="Jump to top"
                sx={{
                  position: "absolute",
                  top: 8,
                  right: 16,
                  zIndex: 1,
                  bgcolor: "background.paper",
                  boxShadow: 2,
                  "&:hover": { bgcolor: "background.paper" },
                }}
              >
                <KeyboardArrowUpIcon fontSize="small" />
              </MuiIconButton>
            </Tooltip>
          )}
          {showJumpBottom && (
            <Tooltip title="Jump to bottom">
              <MuiIconButton
                size="small"
                onClick={scrollToBottomImpl}
                aria-label="Jump to bottom"
                sx={{
                  position: "absolute",
                  bottom: 8,
                  right: 16,
                  zIndex: 1,
                  bgcolor: "background.paper",
                  boxShadow: 2,
                  "&:hover": { bgcolor: "background.paper" },
                }}
              >
                <KeyboardArrowDownIcon fontSize="small" />
              </MuiIconButton>
            </Tooltip>
          )}
          {statusStrip && (
            <Box
              data-testid="chat-status-strip"
              sx={{
                position: "absolute",
                bottom: 8,
                left: 16,
                // Clear of the jump-to-bottom button in the corner.
                right: 64,
                zIndex: 1,
                display: "flex",
                justifyContent: "flex-start",
                // Never intercept clicks or text selection in the feed beneath.
                pointerEvents: "none",
              }}
            >
              {statusStrip}
            </Box>
          )}
        </Box>
        <Box sx={{ flexShrink: 0, p: 2, borderTop: 1, borderColor: "divider" }}>
          <TextField
            autoFocus
            multiline
            minRows={2}
            maxRows={6}
            fullWidth
            placeholder={CHAT_INPUT_PLACEHOLDER}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            sx={{ mb: 1 }}
          />
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            {isMobile ? (
              <>
                <Tooltip title="Exit">
                  <IconButton
                    icon={IconName.ArrowBack}
                    onClick={onExit}
                    aria-label="Exit"
                  />
                </Tooltip>
                <Box sx={{ flex: 1 }} />
                <Tooltip title="Cancel">
                  <span>
                    <IconButton
                      icon={IconName.Close}
                      color="secondary"
                      onClick={onCancel}
                      disabled={!disabled}
                      aria-label="Cancel"
                    />
                  </span>
                </Tooltip>
                <Tooltip title="Reset">
                  <IconButton
                    icon={IconName.Refresh}
                    onClick={onReset}
                    aria-label="Reset"
                  />
                </Tooltip>
                <Tooltip title="Submit">
                  <span>
                    <IconButton
                      icon={IconName.Send}
                      color="primary"
                      onClick={handleSubmit}
                      disabled={disabled || !value.trim()}
                      aria-label="Submit"
                    />
                  </span>
                </Tooltip>
              </>
            ) : (
              <>
                <Button
                  variant="outlined"
                  onClick={onExit}
                  startIcon={<Icon name={IconName.ArrowBack} />}
                >
                  Exit
                </Button>
                <Box sx={{ flex: 1 }} />
                <Button
                  variant="outlined"
                  color="secondary"
                  onClick={onCancel}
                  disabled={!disabled}
                  startIcon={<Icon name={IconName.Close} />}
                >
                  Cancel
                </Button>
                <Button variant="outlined" onClick={onReset}>
                  Reset
                </Button>
                <Button
                  variant="contained"
                  onClick={handleSubmit}
                  disabled={disabled || !value.trim()}
                  startIcon={<Icon name={IconName.Send} />}
                >
                  Submit
                </Button>
              </>
            )}
          </Stack>
        </Box>
      </Box>
    );
  }
);
