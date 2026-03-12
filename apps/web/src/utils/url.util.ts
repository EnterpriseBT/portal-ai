type ParamValue = string | number | boolean | undefined | null;

export const buildSearchParams = (params: Record<string, ParamValue>) => {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    searchParams.append(key, String(value));
  }
  return searchParams.toString();
};

export const buildUrl = (base: string, params?: Record<string, ParamValue>) => {
  if (!params) return base;
  const qs = buildSearchParams(params);
  return qs ? `${base}?${qs}` : base;
};
