import type { SelectOption } from "./types.js";

/**
 * An option's React key: its value, which is its identity. MUI's Autocomplete
 * keys by `getOptionLabel` when no `getOptionKey` is given, so two options with
 * the same label shared a key and React could drop or duplicate one (#986).
 * Every searchable select passes this.
 */
export const selectOptionKey = (option: SelectOption): string =>
  String(option.value);
