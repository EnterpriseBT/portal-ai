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
    expect(visited).toEqual(["https://app.example.test/login?qa=1"]);
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
