/**
 * Google Picker + browser token client (#408).
 *
 * The connector moved from `drive.readonly` to `drive.file`, which grants
 * access one file at a time and only through a Picker selection the user
 * makes themselves. That selection has to happen in the browser — there is
 * no server-side equivalent — so this module owns the two browser-side
 * pieces: minting a token, and running the Picker with it.
 *
 * Nothing here reads context: every value arrives as an argument so the
 * module is testable without a Vite build. The `import.meta.env` reads live
 * at the bottom as exported constants, which is the only place a build-time
 * value enters (the `?.` follows `contact.util.ts` — `import.meta.env` does
 * not exist under jest).
 */

export interface PickedSheet {
  spreadsheetId: string;
  name: string;
}

export interface BrowserToken {
  accessToken: string;
  /** Resolved from userinfo — the account the user actually authorized. */
  email: string;
}

const API_JS_SRC = "https://apis.google.com/js/api.js";
const GIS_SRC = "https://accounts.google.com/gsi/client";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

/**
 * `openid` + `email` ride along with `drive.file` so the token can name its
 * own account through userinfo. Without them userinfo answers 401 and the
 * account-match guard has nothing to compare a selection against.
 *
 * Google grants these back expanded — `openid userinfo.email drive.file` —
 * so never compare a granted scope string against this one.
 */
const TOKEN_SCOPES = "openid email https://www.googleapis.com/auth/drive.file";

/** Minimal shapes for the two Google globals; the SDKs ship no types we use. */
interface GapiGlobal {
  load: (module: string, callback: () => void) => void;
}

interface PickerDocument {
  id: string;
  name: string;
}

interface PickerCallbackData {
  action: string;
  docs?: PickerDocument[];
}

interface PickerBuilderLike {
  setAppId(id: string): PickerBuilderLike;
  setOAuthToken(token: string): PickerBuilderLike;
  setDeveloperKey(key: string): PickerBuilderLike;
  addView(view: unknown): PickerBuilderLike;
  setCallback(cb: (data: PickerCallbackData) => void): PickerBuilderLike;
  build(): { setVisible(visible: boolean): void };
}

interface GoogleGlobal {
  picker?: {
    PickerBuilder: new () => PickerBuilderLike;
    DocsView: new (viewId: unknown) => unknown;
    ViewId: { SPREADSHEETS: unknown };
    Action: { PICKED: string; CANCEL: string };
  };
  accounts?: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        hint?: string;
        callback: (resp: {
          access_token?: string;
          scope?: string;
          error?: string;
          error_description?: string;
        }) => void;
        error_callback?: (err: { type?: string; message?: string }) => void;
      }) => { requestAccessToken: () => void };
    };
  };
}

function googleGlobal(): GoogleGlobal | undefined {
  return (window as unknown as { google?: GoogleGlobal }).google;
}

function gapiGlobal(): GapiGlobal | undefined {
  return (window as unknown as { gapi?: GapiGlobal }).gapi;
}

/**
 * Cached per source so concurrent callers share one tag and a repeat call is
 * free. A rejection is cached too: a blocked script does not become
 * available by asking again, and the step renders `pickerUnavailable` rather
 * than retrying into the same wall.
 *
 * Both Google SDKs are fetched on demand rather than from `index.html` —
 * only the Google Sheets connector needs them, and a third-party script on
 * every page load is a cost every other route would pay for nothing.
 */
const scriptCache = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const cached = scriptCache.get(src);
  if (cached) return cached;

  const pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () =>
      reject(new Error(`Google picker script failed to load: ${src}`))
    );
    document.head.appendChild(script);
  });

  scriptCache.set(src, pending);
  return pending;
}

/**
 * The Picker appends its dialog to `<body>` at z-index ~1000, which is
 * below MUI's AppBar (1100) and below the workflow's own Modal (1300) — it
 * renders, but behind the navbar and the dialog that opened it, so the user
 * cannot reach it. MUI's highest default layer is the tooltip at 1500, so
 * the override clears that.
 *
 * A stylesheet rather than a theme token because the Picker's markup is
 * Google's, injected outside React entirely; there is no component here to
 * pass an `sx` to.
 */
const PICKER_Z_INDEX_CSS = `
.picker-dialog-bg { z-index: 1600 !important; }
.picker-dialog { z-index: 1601 !important; }
`;

function injectPickerStyles(): void {
  const marker = "google-picker";
  if (document.head.querySelector(`style[data-portalai="${marker}"]`)) return;
  const style = document.createElement("style");
  style.setAttribute("data-portalai", marker);
  style.textContent = PICKER_Z_INDEX_CSS;
  document.head.appendChild(style);
}

/** Loads `gapi` + the picker module once, idempotently. */
export async function loadPicker(): Promise<void> {
  injectPickerStyles();
  if (googleGlobal()?.picker) return;

  await loadScript(API_JS_SRC);
  const gapi = gapiGlobal();
  if (!gapi) throw new Error("Google picker script loaded without gapi");

  await new Promise<void>((resolve) => gapi.load("picker", () => resolve()));
}

/**
 * Loads Google Identity Services, which mints the browser token. Nothing
 * else in the app pulls it in — before #408 there was no browser-side
 * Google SDK at all.
 */
async function loadGis(): Promise<void> {
  if (googleGlobal()?.accounts?.oauth2) return;
  await loadScript(GIS_SRC);
  if (!googleGlobal()?.accounts?.oauth2) {
    throw new Error("Google Identity Services loaded without accounts.oauth2");
  }
}

/**
 * Opens the Picker and resolves with the selection, or `null` on cancel.
 *
 * `appId` is REQUIRED. Without it the Picker never associates the choice
 * with this app, so no per-file grant is created and the later Sheets read
 * fails with **404 "Requested entity was not found"** — not 403 — which
 * reads as a rejected scope and sends the next person hunting in the wrong
 * place. Discovery lost a cycle to exactly this, so a missing value fails
 * here, loudly, instead of opening a picker that grants nothing.
 */
export async function openSheetPicker(args: {
  oauthToken: string;
  developerKey: string;
  appId: string;
}): Promise<PickedSheet | null> {
  if (!args.appId) {
    throw new Error(
      "openSheetPicker requires an appId (cloud project number) — without it the Picker creates no drive.file grant"
    );
  }

  await loadPicker();
  const picker = googleGlobal()?.picker;
  if (!picker) throw new Error("Google picker namespace is unavailable");

  return new Promise<PickedSheet | null>((resolve) => {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS);
    new picker.PickerBuilder()
      .setAppId(args.appId)
      .setOAuthToken(args.oauthToken)
      .setDeveloperKey(args.developerKey)
      .addView(view)
      .setCallback((data: PickerCallbackData) => {
        if (data.action === picker.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(doc ? { spreadsheetId: doc.id, name: doc.name } : null);
          return;
        }
        if (data.action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}

/**
 * Mints a browser-side `drive.file` token through GIS and names the account
 * that authorized it.
 *
 * `loginHint` pre-selects the connector's Google account in the chooser. It
 * is a nudge, not a constraint — the user can still pick another account,
 * which is why this returns the resolved `email` for the caller to check
 * rather than trusting the hint took.
 */
export async function requestBrowserToken(args: {
  clientId: string;
  loginHint: string | null;
}): Promise<BrowserToken> {
  await loadGis();
  const oauth2 = googleGlobal()?.accounts?.oauth2;
  if (!oauth2) throw new Error("Google Identity Services is unavailable");

  return new Promise<BrowserToken>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: args.clientId,
      scope: TOKEN_SCOPES,
      ...(args.loginHint ? { hint: args.loginHint } : {}),
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(
            new Error(
              resp.error ?? "Google returned no access token for the Picker"
            )
          );
          return;
        }
        void resolveEmail(resp.access_token).then(
          (email) =>
            resolve({ accessToken: resp.access_token as string, email }),
          reject
        );
      },
      error_callback: (err) => {
        reject(new Error(err.type ?? err.message ?? "popup_closed"));
      },
    });
    client.requestAccessToken();
  });
}

async function resolveEmail(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(
      `Google userinfo failed (${res.status}) — cannot confirm which account was authorized`
    );
  }
  const body = (await res.json()) as { email?: string };
  if (!body.email) {
    throw new Error("Google userinfo returned no email address");
  }
  return body.email;
}

// Build-time config. `?.` because `import.meta.env` does not exist outside a
// Vite build (jest, node scripts) — the module must import cleanly there.
export const PICKER_API_KEY: string =
  import.meta.env?.VITE_GOOGLE_PICKER_API_KEY ?? "";
export const PICKER_CLIENT_ID: string =
  import.meta.env?.VITE_GOOGLE_OAUTH_CLIENT_ID ?? "";
export const PICKER_APP_ID: string =
  import.meta.env?.VITE_GOOGLE_CLOUD_PROJECT_NUMBER ?? "";

/**
 * True when every build-time value the Picker needs is present. The step
 * renders a configuration message rather than an empty selector when this is
 * false — a missing key is our problem, and saying "no spreadsheets found"
 * would blame the user's Google account for it.
 */
export const isPickerConfigured = (): boolean =>
  Boolean(PICKER_API_KEY && PICKER_CLIENT_ID && PICKER_APP_ID);
