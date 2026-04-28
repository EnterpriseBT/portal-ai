import React, { useCallback, useEffect, useRef, useState } from "react";

import { TextInput, type TextInputProps } from "./TextInput.js";

export type DeferredTextInputProps = TextInputProps & {
  /** Debounce delay in ms. When set, onChange also fires after the user stops
   *  typing for this duration (in addition to the existing blur behaviour).
   *  Defaults to 0 (disabled — blur only). */
  debounceMs?: number;
};

/**
 * A TextInput that manages local state during editing and only propagates
 * changes on blur (and optionally after a debounce delay). Use this in forms
 * with many fields to avoid re-rendering the entire form on every keystroke.
 */
export const DeferredTextInput = React.forwardRef<
  HTMLDivElement,
  DeferredTextInputProps
>(({ value, onChange, onBlur, debounceMs = 0, ...props }, ref) => {
  const externalValue = String(value ?? "");
  const [state, setState] = useState({
    local: externalValue,
    external: externalValue,
  });
  const onChangeRef = useRef(onChange);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Clean up pending debounce on unmount
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  // Derive display value: if external prop changed, sync; otherwise use local
  const displayValue =
    externalValue !== state.external ? externalValue : state.local;
  if (externalValue !== state.external) {
    setState({ local: externalValue, external: externalValue });
  }

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setState((prev) => ({ ...prev, local: val }));

      if (debounceMs > 0) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        // Capture the native event's value before the synthetic event is recycled
        const syntheticTarget = { ...e.target, value: val };
        debounceRef.current = setTimeout(() => {
          setState((prev) => {
            if (prev.local !== prev.external) {
              onChangeRef.current?.({
                target: syntheticTarget,
              } as React.ChangeEvent<HTMLInputElement>);
              return { local: prev.local, external: prev.local };
            }
            return prev;
          });
        }, debounceMs);
      }
    },
    [debounceMs]
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      // Cancel any pending debounce — blur commits immediately
      if (debounceRef.current) clearTimeout(debounceRef.current);

      setState((prev) => {
        if (prev.local !== prev.external) {
          onChangeRef.current?.(
            e as unknown as React.ChangeEvent<HTMLInputElement>
          );
          return { local: prev.local, external: prev.local };
        }
        return prev;
      });
      onBlur?.(e);
    },
    [onBlur]
  );

  return (
    <TextInput
      ref={ref}
      {...props}
      value={displayValue}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
});

export default DeferredTextInput;
