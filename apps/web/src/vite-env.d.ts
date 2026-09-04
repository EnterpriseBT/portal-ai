/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH0_DOMAIN: string;
  readonly VITE_AUTH0_CLIENT_ID: string;
  readonly VITE_AUTH0_AUDIENCE: string;
  readonly VITE_APP_VERSION: string;
  readonly VITE_APP_SHA: string;
  readonly VITE_API_BASE_URL: string;
  /** Business contact addresses (#369) — injected at build time from SSM. */
  readonly VITE_SUPPORT_EMAIL: string;
  readonly VITE_SALES_EMAIL: string;
  /** Marketing-site origin (#506) — where the login consent links point.
   *  Per-env (prod `www.`, app-dev `site-dev.`); injected at build time. */
  readonly VITE_SITE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
