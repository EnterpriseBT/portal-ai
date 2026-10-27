import { describe, it, expect } from "@jest/globals";

import {
  isPublicOrigin,
  publicUrlWarnings,
} from "../../utils/public-url.util.js";

describe("isPublicOrigin (#889, #891)", () => {
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "http://0.0.0.0:3000",
    "http://127.0.1.1:3000",
    "http://127.0.0.2",
    "http://127.1",
    "http://2130706433",
    "http://[::ffff:127.0.0.1]",
    "http://[0:0:0:0:0:0:0:1]",
    "http://[::]",
    "http://0",
    "http://LOCALHOST",
    "http://localhost.",
    "http://web.localhost",
    "ftp://app.example",
    "",
    "not a url",
  ])("rejects %p", (url) => {
    expect(isPublicOrigin(url)).toBe(false);
  });

  it.each([
    "https://app.example",
    "https://127.example.com",
    "http://portal.corp:8080",
    "https://api-dev.portalsai.io/",
  ])("accepts %p", (url) => {
    expect(isPublicOrigin(url)).toBe(true);
  });
});

describe("publicUrlWarnings (#891)", () => {
  const real = {
    NODE_ENV: "production",
    WEB_APP_URL: "https://app.example",
    PUBLIC_API_BASE_URL: "https://api.example",
  };

  it("says nothing when both are public origins", () => {
    expect(publicUrlWarnings(real)).toEqual([]);
  });

  it("says nothing outside production, where localhost is right", () => {
    expect(
      publicUrlWarnings({
        NODE_ENV: "development",
        WEB_APP_URL: "http://localhost:3000",
        PUBLIC_API_BASE_URL: "http://localhost:3001",
      })
    ).toEqual([]);
  });

  it("names PUBLIC_API_BASE_URL, its value, and that only callback webhook tools need it", () => {
    const [w, ...rest] = publicUrlWarnings({
      ...real,
      PUBLIC_API_BASE_URL: "http://localhost:3001",
    });
    expect(rest).toEqual([]);
    expect(w.setting).toBe("PUBLIC_API_BASE_URL");
    expect(w.value).toBe("http://localhost:3001");
    expect(w.message).toMatch(/PUBLIC_API_BASE_URL/);
    expect(w.message).toMatch(/stream data in, or return results too large/);
    expect(w.message).toMatch(/Plain webhook tools and the rest of the app/);
  });

  it("names WEB_APP_URL and that invitations are refused", () => {
    const [w] = publicUrlWarnings({ ...real, WEB_APP_URL: "" });
    expect(w.setting).toBe("WEB_APP_URL");
    expect(w.value).toBe("");
    expect(w.message).toMatch(/Invitations are refused/);
  });

  it("warns once per bad setting", () => {
    expect(
      publicUrlWarnings({
        NODE_ENV: "production",
        WEB_APP_URL: "http://localhost:3000",
        PUBLIC_API_BASE_URL: "http://127.0.0.1:3001",
      }).map((w) => w.setting)
    ).toEqual(["WEB_APP_URL", "PUBLIC_API_BASE_URL"]);
  });
});
