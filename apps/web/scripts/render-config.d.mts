// Type declaration for the dependency-free render-config.mjs (#566), so the
// jest unit test importing it type-checks. The implementation is plain ESM JS
// because it runs under bare node inside the nginx runtime image.
export declare function renderConfigJs(
  env?: Record<string, string | undefined>
): string;
