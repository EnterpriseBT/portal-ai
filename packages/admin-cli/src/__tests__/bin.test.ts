import { jest } from "@jest/globals";

import {
  cliEnvMockModule,
  resetCliEnvMocks,
  mocks,
} from "./helpers/cli-env-mock.js";
import { AdminNotFoundError } from "../errors.js";

jest.unstable_mockModule("@portalai/cli-env", () => cliEnvMockModule());

const mockStore = {
  listOrgs: jest.fn<() => Promise<unknown[]>>(),
  getUserByEmail: jest.fn<() => Promise<unknown>>(),
  close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
};
jest.unstable_mockModule("../store.js", () => ({
  createDbAdminStore: () => mockStore,
}));

const { runCli } = await import("../bin.js");

let out = "";
let err = "";
let outSpy: ReturnType<typeof jest.spyOn>;
let errSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  resetCliEnvMocks();
  mockStore.listOrgs.mockReset();
  mockStore.getUserByEmail.mockReset();
  mockStore.close.mockReset().mockResolvedValue(undefined);
  out = "";
  err = "";
  outSpy = jest.spyOn(process.stdout, "write").mockImplementation(((
    s: string
  ) => {
    out += s;
    return true;
  }) as never);
  errSpy = jest.spyOn(process.stderr, "write").mockImplementation(((
    s: string
  ) => {
    err += s;
    return true;
  }) as never);
  mocks.resolveEnvConnection.mockResolvedValue({
    env: "app-dev",
    kind: "staging",
    apiBaseUrl: "x",
    db: async () => ({
      connectionString: "postgresql://u:p@h:1/db",
      close: async () => {},
    }),
    token: async () => "t",
    dispose: async () => {},
  });
});
afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
});

describe("runCli — the agent contract", () => {
  it("missing --env is a usage error → exit 2", async () => {
    const code = await runCli(["org", "list"]);
    expect(code).toBe(2);
  });

  it("a domain not-found maps to exit 8 with the --json envelope", async () => {
    mockStore.getUserByEmail.mockRejectedValue(
      new AdminNotFoundError("User x@y.z not found")
    );
    const code = await runCli([
      "user",
      "get",
      "x@y.z",
      "--env",
      "app-dev",
      "--json",
    ]);
    expect(code).toBe(8);
    expect(JSON.parse(out.trim())).toEqual({
      error: { code: "ADMIN_NOT_FOUND", message: "User x@y.z not found" },
    });
  });

  it("banner on stderr; --json payload alone on stdout", async () => {
    mockStore.listOrgs.mockResolvedValue([{ id: "o-1", name: "Acme" }]);
    const code = await runCli(["org", "list", "--env", "app-dev", "--json"]);
    expect(code).toBe(0);
    expect(err).toContain("[env: app-dev (staging)]");
    expect(JSON.parse(out.trim())).toEqual({
      orgs: [{ id: "o-1", name: "Acme" }],
    });
    expect(out).not.toContain("[env:");
  });
});
