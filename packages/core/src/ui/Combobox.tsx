import React, { useId } from "react";
import useAutocomplete from "@mui/material/useAutocomplete";
import Box from "@mui/material/Box";
import InputBase from "@mui/material/InputBase";
import { useForkRef } from "@mui/material/utils";

import type { ActionGate } from "./ActionGate.js";
import { StatusMessage } from "./StatusMessage.js";

export interface ComboboxOption {
  /** Unique across the list. */
  id: string;
  /** The option's accessible name. */
  label: string;
  /** The heading it's listed under. Options of one group must be adjacent. */
  group?: string;
  /** A destination: the option renders as a link and Enter follows it. */
  href?: string;
  /** An action: picking the option calls it. */
  onSelect?: () => void;
  /**
   * An action's gate (#688). `disable` and `upsell` keep the option
   * reachable (so its reason can be read) but picking a `disable` one does
   * nothing; `hide` drops it.
   */
  gate?: ActionGate;
}

export interface ComboboxProps<T extends ComboboxOption = ComboboxOption> {
  /** The options to list, already filtered and ordered by the caller. */
  options: T[];
  inputValue: string;
  onInputChange: (value: string) => void;
  /** The input's accessible name. */
  label: string;
  placeholder?: string;
  /** What the live region says, such as "8 results" or "Loading…". */
  statusText: string;
  /** The option's content. Defaults to its label. */
  renderOption?: (option: T) => React.ReactNode;
  /** Rendered in place of the list when there are no options. */
  emptyContent?: React.ReactNode;
  /** Renders link options; core can't import the app's router. */
  linkComponent?: React.ElementType;
  inputRef?: React.Ref<HTMLInputElement>;
}

// The shell's look, from theme tokens. The hook marks the highlighted
// option with `Mui-focused` (and `Mui-focusVisible` from the keyboard).
const COMBOBOX_SX = {
  "& .ComboboxInput": {
    px: 2,
    py: 1.5,
    borderBottom: 1,
    borderColor: "divider",
  },
  "& .ComboboxInput.Mui-focused": {
    borderBottomColor: "primary.main",
    boxShadow: (theme: { palette: { primary: { main: string } } }) =>
      `inset 0 -1px 0 ${theme.palette.primary.main}`,
  },
  "& .ComboboxList, & .ComboboxList ul": {
    listStyle: "none",
    m: 0,
    p: 0,
  },
  "& .ComboboxList": { maxHeight: 400, overflowY: "auto", py: 1 },
  "& .ComboboxGroupLabel": {
    typography: "overline",
    color: "text.secondary",
    px: 2,
    pt: 1,
  },
  "& .ComboboxOption": {
    display: "flex",
    alignItems: "center",
    gap: 1.5,
    px: 2,
    py: 1,
    color: "text.primary",
    textDecoration: "none",
    cursor: "pointer",
  },
  "& .ComboboxOption.Mui-focused": { bgcolor: "action.hover" },
  "& .ComboboxOption.Mui-focusVisible": { bgcolor: "action.selected" },
  "& .ComboboxOption[aria-disabled='true']": { cursor: "default" },
} as const;

/**
 * A search input over a list that's always shown (#1122): the shell for a
 * command palette, not a popup select. MUI's headless `useAutocomplete`
 * gives the APG combobox: `aria-activedescendant` on the input, arrows,
 * Home/End and Enter, grouped options and the highlight. Escape is left to
 * the host (a `Modal` closes on it).
 *
 * An option with an `href` is a link with `role="option"` (ARIA allows it
 * on a link), so a click, Ctrl-click or middle-click behaves as a link's
 * does; Enter clicks it. Any other option is an action.
 */
export function Combobox<T extends ComboboxOption = ComboboxOption>({
  options,
  inputValue,
  onInputChange,
  label,
  placeholder,
  statusText,
  renderOption,
  emptyContent,
  linkComponent,
  inputRef,
}: ComboboxProps<T>) {
  const id = useId();
  const visible = options.filter((option) => option.gate?.kind !== "hide");
  const grouped = visible.some((option) => option.group !== undefined);

  const {
    getRootProps,
    getInputProps,
    getListboxProps,
    getOptionProps,
    groupedOptions,
  } = useAutocomplete<T, false, false, false>({
    id,
    options: visible,
    // Shown whenever there's something to show: an empty listbox isn't a
    // valid one, and the input then controls nothing.
    open: visible.length > 0,
    value: null,
    inputValue,
    onInputChange: (_event, value, reason) => {
      // "reset" is the hook putting a picked option's label in the box.
      if (reason !== "reset") onInputChange(value);
    },
    onChange: (event, option) => {
      if (!option) return;
      if (option.gate?.kind === "disable") return;
      if (option.gate?.kind === "upsell") {
        option.gate.onUpgrade();
        return;
      }
      if (option.href) {
        // A click on the link navigates by itself. Enter doesn't, so it
        // clicks the highlighted link, which the link then handles.
        if (event.type === "keydown") {
          const index = visible.indexOf(option);
          const node = document.querySelector<HTMLElement>(
            `[id="${id}-option-${index}"]`
          );
          node?.click();
        }
        return;
      }
      option.onSelect?.();
    },
    getOptionLabel: (option) => option.label,
    isOptionEqualToValue: (option, value) => option.id === value.id,
    getOptionDisabled: (option) => option.gate?.kind === "disable",
    // A disabled option stays reachable, so its reason can be read.
    disabledItemsFocusable: true,
    // Always grouped, so the hook's types are one shape; an ungrouped
    // list is one unlabelled group, rendered flat.
    groupBy: (option: T) => option.group ?? "",
    filterOptions: (x) => x,
    autoHighlight: true,
    clearOnBlur: false,
    disableCloseOnSelect: true,
    handleHomeEndKeys: true,
  });

  const { ref: hookInputRef, ...inputProps } = getInputProps();
  const setInputRef = useForkRef(hookInputRef, inputRef);

  const renderOne = (option: T, index: number) => {
    const { key, ...optionProps } = getOptionProps({ option, index });
    const content = renderOption ? renderOption(option) : option.label;
    if (option.href) {
      const Link = linkComponent ?? "a";
      return (
        <li key={key} role="none">
          <Box
            component={Link}
            href={option.href}
            {...(optionProps as React.HTMLAttributes<HTMLElement>)}
            className="ComboboxOption"
          >
            {content}
          </Box>
        </li>
      );
    }
    return (
      <Box component="li" key={key} {...optionProps} className="ComboboxOption">
        {content}
      </Box>
    );
  };

  // Each option's index in the flat list, which the hook's ids use.
  const flatIndex = (option: T) => visible.indexOf(option);

  return (
    <Box {...getRootProps()} className="Combobox" sx={COMBOBOX_SX}>
      <InputBase
        fullWidth
        inputRef={setInputRef}
        placeholder={placeholder}
        inputProps={{ ...inputProps, "aria-label": label }}
        className="ComboboxInput"
      />
      <StatusMessage visuallyHidden message={statusText} />
      {visible.length === 0 ? (
        emptyContent
      ) : (
        <Box component="ul" {...getListboxProps()} className="ComboboxList">
          {groupedOptions.map((group) => {
            const items = group.options.map((option) =>
              renderOne(option, flatIndex(option))
            );
            if (!grouped) return items;
            const headingId = `${id}-group-${group.key}`;
            return (
              <li key={group.key} role="none">
                <div
                  id={headingId}
                  role="presentation"
                  className="ComboboxGroupLabel"
                >
                  {group.group}
                </div>
                <ul role="group" aria-labelledby={headingId}>
                  {items}
                </ul>
              </li>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

export default Combobox;
