import type React from "react";

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
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
