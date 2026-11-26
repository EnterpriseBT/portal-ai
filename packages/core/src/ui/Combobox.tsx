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
   * Read after the option's name (`aria-describedby`), not as part of it.
   * Defaults to a `disable` or `upsell` gate's reason, so a row can show
   * the reason visually (marked `aria-hidden`) without it joining the name.
   */
  description?: string;
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
  /** Rendered, padded, in place of the list when there are no options. */
  emptyContent?: React.ReactNode;
  /** Rendered below the list, set off by a rule (a palette's key hints). */
  footer?: React.ReactNode;
  /** Renders link options; core can't import the app's router. */
  linkComponent?: React.ElementType;
  /**
   * Called when a link option is followed, by click or Enter. A host that
   * should close on any pick calls its close here (#1076): a link to the
   * page you're already on changes no location, so nothing else would.
   */
  onFollowLink?: (option: T) => void;
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
  "& .ComboboxEmpty": { p: 2, color: "text.secondary" },
  "& .ComboboxFooter": {
    display: "flex",
    flexWrap: "wrap",
    gap: 2,
    pt: 1,
    borderTop: 1,
    borderColor: "divider",
  },
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
  footer,
  linkComponent,
  onFollowLink,
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
      // Only the user's typing (or clearing) changes the query. The hook
      // also writes a picked option's label ("selectOption"), a reset or a
      // blur into the box, which would replace the search with that label.
      if (reason === "input" || reason === "clear") onInputChange(value);
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
          const root = (event.target as HTMLElement).closest(".Combobox");
          root
            ?.querySelector<HTMLElement>(`[data-option-index="${index}"]`)
            ?.click();
        }
        return;
      }
      option.onSelect?.();
    },
    getOptionLabel: (option) => option.label,
    // Keyed by id: two options may share a label ("Finance" the station
    // and the view), and a label key would let React mix up their rows.
    getOptionKey: (option) => option.id,
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
    const gate = option.gate;
    const description =
      option.description ??
      (gate?.kind === "disable" || gate?.kind === "upsell"
        ? gate.reason
        : undefined);
    const descriptionId = description
      ? `${id}-option-${index}-description`
      : undefined;
    const body = (
      <>
        {content}
        {description && (
          <span id={descriptionId} hidden>
            {description}
          </span>
        )}
      </>
    );
    // #1076: a gated link isn't a link, so a click can't follow it; picking
    // it still runs the gate (an upsell's onUpgrade, a disable's nothing).
    const gated =
      option.gate?.kind === "disable" || option.gate?.kind === "upsell";
    if (option.href && !gated) {
      const Link = linkComponent ?? "a";
      return (
        <li key={key} role="none">
          <Box
            component={Link}
            href={option.href}
            {...(optionProps as React.HTMLAttributes<HTMLElement>)}
            onClick={(event: React.MouseEvent<HTMLElement>) => {
              (optionProps as React.HTMLAttributes<HTMLElement>).onClick?.(
                event
              );
              onFollowLink?.(option);
            }}
            aria-describedby={descriptionId}
            className="ComboboxOption"
          >
            {body}
          </Box>
        </li>
      );
    }
    return (
      <Box
        component="li"
        key={key}
        {...optionProps}
        aria-describedby={descriptionId}
        className="ComboboxOption"
      >
        {body}
      </Box>
    );
  };

  return (
    <Box
      {...getRootProps({
        // Escape belongs to the host (a Modal closes on it). The hook would
        // otherwise claim it to close a list that never closes here, and a
        // Modal ignores an Escape that's already been handled.
        onKeyDown: (
          event: React.KeyboardEvent & { defaultMuiPrevented?: boolean }
        ) => {
          if (event.key === "Escape") event.defaultMuiPrevented = true;
        },
      })}
      className="Combobox"
      sx={COMBOBOX_SX}
    >
      <InputBase
        fullWidth
        inputRef={setInputRef}
        placeholder={placeholder}
        inputProps={{ ...inputProps, "aria-label": label }}
        className="ComboboxInput"
      />
      <StatusMessage visuallyHidden message={statusText} />
      {visible.length === 0 ? (
        <div className="ComboboxEmpty">{emptyContent}</div>
      ) : (
        <Box component="ul" {...getListboxProps()} className="ComboboxList">
          {groupedOptions.map((group) => {
            // A group's `index` is its first option's place in the flat
            // list, which the hook's option ids use.
            const items = group.options.map((option, i) =>
              renderOne(option, group.index + i)
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
      {footer && <div className="ComboboxFooter">{footer}</div>}
    </Box>
  );
}

export default Combobox;
