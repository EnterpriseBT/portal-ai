import React, { useCallback, useEffect, useRef, useState } from "react";

import { TextInput, type TextInputProps } from "./TextInput.js";

export type DeferredTextInputProps = TextInputProps;

/**
 * A TextInput that manages local state during editing and only propagates
 * changes on blur. Use this in forms with many fields to avoid re-rendering
 * the entire form on every keystroke.
 */
export const DeferredTextInput = React.forwardRef<HTMLDivElement, DeferredTextInputProps>(
  ({ value, onChange, onBlur, ...props }, ref) => {
    const externalValue = String(value ?? "");
    const [state, setState] = useState({ local: externalValue, external: externalValue });
    const onChangeRef = useRef(onChange);

    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    // Derive display value: if external prop changed, sync; otherwise use local
    const displayValue = externalValue !== state.external ? externalValue : state.local;
    if (externalValue !== state.external) {
      setState({ local: externalValue, external: externalValue });
    }

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setState((prev) => ({ ...prev, local: val }));
    }, []);

    const handleBlur = useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        setState((prev) => {
          if (prev.local !== prev.external) {
            onChangeRef.current?.(e as unknown as React.ChangeEvent<HTMLInputElement>);
            return { local: prev.local, external: prev.local };
          }
          return prev;
        });
        onBlur?.(e);
      },
      [onBlur],
    );

    return <TextInput ref={ref} {...props} value={displayValue} onChange={handleChange} onBlur={handleBlur} />;
  },
);

export default DeferredTextInput;
