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
