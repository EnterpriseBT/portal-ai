import React, { useContext, useRef, useCallback, useEffect } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";

/** Context used to pass the sentinel registration callback to the listbox. */
export const SentinelRefContext = React.createContext<
  ((el: HTMLDivElement | null) => void) | null
>(null);

/** Context used to pass the loading state to the listbox. */
export const InfiniteLoadingContext = React.createContext(false);

/** Context used to pass a stable ref that tracks the listbox scroll position. */
export const ScrollTopRef =
  React.createContext<React.MutableRefObject<number> | null>(null);

export const InfiniteListboxComponent = React.forwardRef<
  HTMLUListElement,
  React.HTMLAttributes<HTMLElement>
>(({ children, ...props }, ref) => {
  const setSentinelRef = useContext(SentinelRefContext);
  const loading = useContext(InfiniteLoadingContext);
  const scrollTopRef = useContext(ScrollTopRef);
  const innerRef = useRef<HTMLUListElement | null>(null);

  // Restore scroll position after each render (options append causes re-mount)
  useEffect(() => {
    if (innerRef.current && scrollTopRef) {
      innerRef.current.scrollTop = scrollTopRef.current;
    }
  });

  const handleScroll = useCallback(() => {
    if (innerRef.current && scrollTopRef) {
      scrollTopRef.current = innerRef.current.scrollTop;
    }
  }, [scrollTopRef]);

  const setRefs = useCallback(
    (el: HTMLUListElement | null) => {
      innerRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref)
        (ref as React.MutableRefObject<HTMLUListElement | null>).current = el;
    },
    [ref]
  );

  return (
    <ul ref={setRefs} {...props} onScroll={handleScroll}>
      {children}
      {loading && (
        <Box
          component="li"
          sx={{ display: "flex", justifyContent: "center", py: 1 }}
          aria-label="loading"
        >
          <CircularProgress size={20} />
        </Box>
      )}
      <div
        ref={setSentinelRef}
        data-testid="infinite-scroll-sentinel"
        style={{ height: 1 }}
      />
    </ul>
  );
});
