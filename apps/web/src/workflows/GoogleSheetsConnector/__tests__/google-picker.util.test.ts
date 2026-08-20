/**
 * The Google Picker + browser-token layer (#408).
 *
 * Every case here guards a failure that is hard to read from the symptom:
 * a missing `setAppId` fails later as a 404 that looks like a rejected
 * scope, and a token minted without `openid`+`email` leaves the
 * account-match guard with nothing to compare.
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

interface PickerBuilderCalls {
  appId?: string;
  oauthToken?: string;
  developerKey?: string;
  views: unknown[];
  callback?: (data: unknown) => void;
  setVisibleCalled: boolean;
}

let builderCalls: PickerBuilderCalls;

/** A stand-in for the picker namespace `api.js` installs on `window`. */
function installPickerNamespace(): void {
  builderCalls = { views: [], setVisibleCalled: false };

  class MockPickerBuilder {
    setAppId(id: string) {
      builderCalls.appId = id;
      return this;
    }
    setOAuthToken(t: string) {
      builderCalls.oauthToken = t;
      return this;
    }
    setDeveloperKey(k: string) {
      builderCalls.developerKey = k;
      return this;
    }
    addView(v: unknown) {
      builderCalls.views.push(v);
      return this;
    }
    setCallback(cb: (data: unknown) => void) {
      builderCalls.callback = cb;
      return this;
    }
    build() {
      return {
        setVisible: () => {
          builderCalls.setVisibleCalled = true;
        },
      };
    }
  }

  class MockDocsView {
    constructor(public readonly viewId: string) {}
    setIncludeFolders() {
      return this;
    }
  }

  (window as unknown as Record<string, unknown>).google = {
    picker: {
      PickerBuilder: MockPickerBuilder,
      DocsView: MockDocsView,
      ViewId: { SPREADSHEETS: "spreadsheets" },
      Action: { PICKED: "picked", CANCEL: "cancel" },
      Response: { ACTION: "action", DOCUMENTS: "docs" },
    },
  };
  (window as unknown as Record<string, unknown>).gapi = {
    load: (_module: string, cb: () => void) => cb(),
  };
}

/**
 * `openSheetPicker` awaits `loadPicker` before it builds anything, so the
 * callback is registered a few microtasks after the call. Waiting for it
 * beats guessing a tick count — the test drives the picker only once the
 * picker exists.
 */
async function pickerCallback(): Promise<(data: unknown) => void> {
  for (let i = 0; i < 50 && !builderCalls.callback; i++) {
    await Promise.resolve();
  }
  if (!builderCalls.callback) {
    throw new Error("the Picker callback was never registered");
  }
  return builderCalls.callback;
}

function clearGoogleGlobals(): void {
  delete (window as unknown as Record<string, unknown>).google;
  delete (window as unknown as Record<string, unknown>).gapi;
}

/**
 * jsdom parses injected <script> tags but never fetches them, so nothing
 * ever fires load or error on its own. This watches for the injection and
 * fires the outcome the test wants.
 */
function autoResolveScripts(outcome: "load" | "error"): () => void {
  const original = document.head.appendChild.bind(document.head);
  const patched = ((node: Node) => {
    const result = original(node as never);
    if (node instanceof HTMLScriptElement) {
      queueMicrotask(() => {
        // A real Google SDK installs its global synchronously *before* the
        // load event fires; installing it after would let the util see a
        // loaded script with no namespace on it.
        if (outcome === "load") {
          if (node.src.includes("gsi/client")) {
            if (gisResponder) installTokenClient(gisResponder);
          } else {
            installPickerNamespace();
          }
        }
        node.dispatchEvent(new Event(outcome));
      });
    }
    return result;
  }) as typeof document.head.appendChild;
  document.head.appendChild = patched;
  return () => {
    document.head.appendChild = original;
  };
}

const SCOPES = "openid email https://www.googleapis.com/auth/drive.file";

/** How the GIS stand-in should answer, when the util loads it itself. */
let gisResponder: ((cfg: TokenClientConfig) => void) | null = null;

interface TokenClientConfig {
  client_id: string;
  scope: string;
  hint?: string;
  callback: (resp: Record<string, unknown>) => void;
  error_callback?: (err: Record<string, unknown>) => void;
}

/** Installs GIS and hands back the config the util passed to it. */
function installTokenClient(
  respond: (cfg: TokenClientConfig) => void
): () => TokenClientConfig {
  let captured: TokenClientConfig;
  const google = ((window as unknown as Record<string, unknown>).google ??
    {}) as Record<string, unknown>;
  google.accounts = {
    oauth2: {
      initTokenClient: (cfg: TokenClientConfig) => {
        captured = cfg;
        return { requestAccessToken: () => respond(captured) };
      },
    },
  };
  (window as unknown as Record<string, unknown>).google = google;
  return () => captured;
}

beforeEach(() => {
  jest.resetModules();
  clearGoogleGlobals();
  document.head.innerHTML = "";
  gisResponder = null;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("loadPicker", () => {
  it("injects the api.js script and resolves once the picker module is ready", async () => {
    const restore = autoResolveScripts("load");
    const { loadPicker } = await import("../utils/google-picker.util");

    await loadPicker();

    const scripts = document.head.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toContain("apis.google.com/js/api.js");
    restore();
  });

  it("is idempotent — a second call injects no second script", async () => {
    const restore = autoResolveScripts("load");
    const { loadPicker } = await import("../utils/google-picker.util");

    await loadPicker();
    await loadPicker();

    expect(document.head.querySelectorAll("script")).toHaveLength(1);
    restore();
  });

  it("rejects when the script cannot load", async () => {
    const restore = autoResolveScripts("error");
    const { loadPicker } = await import("../utils/google-picker.util");

    await expect(loadPicker()).rejects.toThrow(/picker/i);
    restore();
  });
});

describe("openSheetPicker", () => {
  beforeEach(() => {
    installPickerNamespace();
  });

  it("passes setAppId — without it no per-file grant is created", async () => {
    const { openSheetPicker } = await import("../utils/google-picker.util");

    const promise = openSheetPicker({
      oauthToken: "ya29.token",
      developerKey: "AIzaKEY",
      appId: "872674925548",
    });
    (await pickerCallback())({ action: "cancel" });
    await promise;

    expect(builderCalls.appId).toBe("872674925548");
    expect(builderCalls.oauthToken).toBe("ya29.token");
    expect(builderCalls.developerKey).toBe("AIzaKEY");
    expect(builderCalls.setVisibleCalled).toBe(true);
  });

  it("resolves the selection on pick", async () => {
    const { openSheetPicker } = await import("../utils/google-picker.util");

    const promise = openSheetPicker({
      oauthToken: "ya29.token",
      developerKey: "AIzaKEY",
      appId: "872674925548",
    });
    (await pickerCallback())({
      action: "picked",
      docs: [{ id: "1abcXYZ", name: "Q3 Forecast" }],
    });

    await expect(promise).resolves.toEqual({
      spreadsheetId: "1abcXYZ",
      name: "Q3 Forecast",
    });
  });

  it("resolves null on cancel", async () => {
    const { openSheetPicker } = await import("../utils/google-picker.util");

    const promise = openSheetPicker({
      oauthToken: "ya29.token",
      developerKey: "AIzaKEY",
      appId: "872674925548",
    });
    (await pickerCallback())({ action: "cancel" });

    await expect(promise).resolves.toBeNull();
  });

  it("rejects when appId is missing rather than opening a picker that grants nothing", async () => {
    const { openSheetPicker } = await import("../utils/google-picker.util");

    await expect(
      openSheetPicker({
        oauthToken: "ya29.token",
        developerKey: "AIzaKEY",
        appId: "",
      })
    ).rejects.toThrow(/appId/i);
    expect(builderCalls.setVisibleCalled).toBe(false);
  });
});

describe("requestBrowserToken", () => {
  it("requests openid + email + drive.file and forwards the login hint", async () => {
    const captured = installTokenClient((cfg) =>
      cfg.callback({ access_token: "ya29.token", scope: SCOPES })
    );
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ email: "alice@example.com" }),
    })) as unknown as typeof fetch;

    const { requestBrowserToken } = await import("../utils/google-picker.util");
    const out = await requestBrowserToken({
      clientId: "client-1.apps.googleusercontent.com",
      loginHint: "alice@example.com",
    });

    expect(captured().scope).toBe(SCOPES);
    expect(captured().hint).toBe("alice@example.com");
    expect(out).toEqual({
      accessToken: "ya29.token",
      email: "alice@example.com",
    });
  });

  it("omits the hint when there is no linked address to steer toward", async () => {
    const captured = installTokenClient((cfg) =>
      cfg.callback({ access_token: "ya29.token" })
    );
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ email: "alice@example.com" }),
    })) as unknown as typeof fetch;

    const { requestBrowserToken } = await import("../utils/google-picker.util");
    await requestBrowserToken({ clientId: "client-1", loginHint: null });

    expect(captured().hint).toBeUndefined();
  });

  it("loads the GIS script when it is not already on the page", async () => {
    // Nothing else pulls accounts.google.com/gsi/client in — before #408 the
    // app had no browser-side Google SDK at all, so the util must fetch it.
    const restore = autoResolveScripts("load");
    gisResponder = (cfg) => cfg.callback({ access_token: "ya29.token" });
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ email: "alice@example.com" }),
    })) as unknown as typeof fetch;
    const { requestBrowserToken } = await import("../utils/google-picker.util");

    await expect(
      requestBrowserToken({ clientId: "client-1", loginHint: null })
    ).resolves.toMatchObject({ email: "alice@example.com" });

    const srcs = Array.from(document.head.querySelectorAll("script")).map(
      (s) => s.src
    );
    expect(srcs.some((s) => s.includes("accounts.google.com/gsi/client"))).toBe(
      true
    );
    restore();
  });

  it("rejects when the user closes the popup or denies access", async () => {
    installTokenClient((cfg) => cfg.callback({ error: "access_denied" }));

    const { requestBrowserToken } = await import("../utils/google-picker.util");

    await expect(
      requestBrowserToken({ clientId: "client-1", loginHint: null })
    ).rejects.toThrow(/access_denied/);
  });

  it("rejects when userinfo will not name the account — the guard needs an address", async () => {
    installTokenClient((cfg) => cfg.callback({ access_token: "ya29.token" }));
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const { requestBrowserToken } = await import("../utils/google-picker.util");

    await expect(
      requestBrowserToken({ clientId: "client-1", loginHint: null })
    ).rejects.toThrow(/userinfo/i);
  });
});
