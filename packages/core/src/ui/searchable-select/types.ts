import type React from "react";

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
  /**
   * Why this option can't be picked, rendered under the label in the
   * dropdown. Only shown when `disabled` is true — a disabled option
   * without a reason is a dead end for the user.
   */
  disabledReason?: string;
  /**
   * Optional leading icon rendered next to the label in dropdown options
   * and (where supported) in selected-value chips.
   */
  icon?: React.ReactNode;
}

export interface SelectBaseProps {
  label?: string;
  placeholder?: string;
  helperText?: string;
  error?: boolean;
  disabled?: boolean;
  required?: boolean;
  size?: "small" | "medium";
  fullWidth?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}

export interface FetchPageParams {
  search: string;
  page: number;
  pageSize: number;
}

export interface FetchPageResult {
  options: SelectOption[];
  hasMore: boolean;
}
