import type { Page } from "@playwright/test";

import {
  E2eSignInError,
  signIn,
  signInEntry,
  signInUrl,
} from "../lib/sign-in.js";

describe("signInEntry", () => {
  it("enters through the #304 dev affordance or the #489 QA sign-in", () => {
    expect(signInEntry("dev")).toEqual({
      path: "/?e2e=1",
      testId: "e2e-dev-login",
    });
    expect(signInEntry("qa")).toEqual({
      path: "/login?qa=1",
      testId: "e2e-qa-login",
    });
  });
});

describe("signInUrl", () => {
  it("is the affordance's own entry by default", () => {
    expect(signInUrl("https://app.example.test", "qa")).toBe(
      "https://app.example.test/login?qa=1"
    );
  });

  // An invite link already carries ?token=; the affordance flag joins it, and
  // Authorized's redirect to /login keeps both.
  it("appends the affordance flag to an entry path's own query", () => {
    expect(
      signInUrl(
        "https://app.example.test",
        "qa",
        "/invitations/accept?token=abc"
      )
    ).toBe("https://app.example.test/invitations/accept?token=abc&qa=1");
    expect(signInUrl("http://localhost:3000", "dev", "/stations")).toBe(
      "http://localhost:3000/stations?e2e=1"
    );
  });
});

describe("signIn", () => {
  it("navigates to the chosen entry and clicks its affordance", async () => {
    const visited: string[] = [];
    const clicked: string[] = [];
    const page = {
      goto: async (url: string) => void visited.push(url),
      getByTestId: (id: string) => ({
        click: async () => {
          clicked.push(id);
          throw new Error("stop here");
        },
      }),
    } as unknown as Page;

    await expect(
      signIn(page, {
        baseUrl: "https://app.example.test",
        username: "qa@x.test",
        password: "pw",
        via: "qa",
      })
    ).rejects.toThrow(E2eSignInError);
    // Then about:blank: a failure never leaves the form up for the screenshot.
    expect(visited).toEqual([
      "https://app.example.test/login?qa=1",
      "about:blank",
    ]);
    expect(clicked).toEqual(["e2e-qa-login"]);
  });

  // A failure message lands in CI logs; the password must never be in it,
  // even when the underlying Playwright error echoes it.
  it("redacts the password from a failure", async () => {
    const secret = "s3cret-Pa55";
    const page = {
      goto: async () => {
        throw new Error(`fill("${secret}") timed out`);
      },
    } as unknown as Page;

    const err = await signIn(page, {
      baseUrl: "http://localhost:3000",
      username: "u@x.test",
      password: secret,
      via: "dev",
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(E2eSignInError);
    expect((err as Error).message).not.toContain(secret);
    expect((err as Error).message).toContain("***");
  });
});

/**
 * A fake Auth0 combined form (#963). `raceFills` password fills land in the
 * username field instead, as Auth0's autofocus did on v1.2.1's verify-login.
 */
function fakeAuth0(opts: { raceFills?: number; combined?: boolean } = {}) {
  const form = { username: "", password: "" };
  let race = opts.raceFills ?? 0;
  const combined = opts.combined ?? true;
  let continued = false;
  const state = {
    form,
    submits: 0,
    visited: [] as string[],
  };
  const field = (name: "username" | "password") => ({
    fill: async (v: string) => {
      if (name === "password" && race > 0) {
        race -= 1;
        form.username += v;
        return;
      }
      form[name] = v;
    },
    inputValue: async () => form[name],
    isVisible: async () => name === "username" || combined || continued,
    waitFor: async () => undefined,
  });
  const page = {
    goto: async (url: string) => void state.visited.push(url),
    getByTestId: () => ({ click: async () => undefined }),
    waitForURL: async (pred: (u: URL) => boolean) => {
      // Leaving the app succeeds; coming back stops the walk after submit.
      if (pred(new URL("https://tenant.auth0.test/u/login"))) return;
      throw new Error("stop after submit");
    },
    waitForLoadState: async () => undefined,
    url: () => "https://tenant.auth0.test/u/login?state=abc",
    locator: (sel: string) => ({
      first: () =>
        sel.includes("password")
          ? field("password")
          : sel.includes("username")
            ? field("username")
            : { allInnerTexts: async () => ["Wrong email or password"] },
      allInnerTexts: async () => ["Wrong email or password"],
    }),
    getByRole: () => ({
      first: () => ({
        click: async () => {
          if (!combined && !continued) continued = true;
          else state.submits += 1;
        },
      }),
    }),
  } as unknown as Page;
  return { page, state };
}

const QA = {
  baseUrl: "https://app.example.test",
  username: "qa@x.test",
  password: "Pa55-secret-value",
  via: "qa" as const,
};

describe("signIn checks the form before submitting (#963)", () => {
  it("submits a correctly filled form once", async () => {
    const { page, state } = fakeAuth0();
    await signIn(page, QA).catch(() => undefined);
    expect(state.submits).toBe(1);
    expect(state.form).toEqual({
      username: QA.username,
      password: QA.password,
    });
  });

  it("re-fills after a focus race and then submits once", async () => {
    const { page, state } = fakeAuth0({ raceFills: 1 });
    await signIn(page, QA).catch(() => undefined);
    expect(state.submits).toBe(1);
    expect(state.form).toEqual({
      username: QA.username,
      password: QA.password,
    });
  });

  it("never submits a form the race keeps winning, and names the field, not the value", async () => {
    const { page, state } = fakeAuth0({ raceFills: 99 });
    const err = (await signIn(page, QA).catch((e: Error) => e)) as Error;
    expect(err).toBeInstanceOf(E2eSignInError);
    expect(state.submits).toBe(0);
    expect(err.message).toMatch(/username field/);
    expect(err.message).not.toContain(QA.password);
  });

  it("checks only the password after an identifier-first Continue", async () => {
    const { page, state } = fakeAuth0({ combined: false });
    await signIn(page, QA).catch(() => undefined);
    expect(state.submits).toBe(1);
  });

  // The failure screenshot is taken after signIn throws, and CI uploads it.
  it("leaves the page on about:blank on failure, keeping Auth0's message in the error", async () => {
    const { page, state } = fakeAuth0({ raceFills: 99 });
    const err = (await signIn(page, QA).catch((e: Error) => e)) as Error;
    expect(state.visited.at(-1)).toBe("about:blank");
    expect(err.message).toContain("Wrong email or password");
    expect(err.message).toContain("tenant.auth0.test/u/login");
    expect(err.message).not.toContain("state=abc");
  });
});
