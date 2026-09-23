import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadLocalEnv } from "../local-env.js";

const KEY = "LOCALENV_TEST_VAR";
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-env-localenv-"));
  delete process.env[KEY];
});
afterEach(() => {
  delete process.env[KEY];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeEnv(value: string) {
  fs.writeFileSync(path.join(tmpDir, ".env"), `${KEY}=${value}\n`);
}

describe("loadLocalEnv", () => {
  it("loads the package .env into process.env for a local env", () => {
    writeEnv("from-file");
    loadLocalEnv("local", tmpDir);
    expect(process.env[KEY]).toBe("from-file");
  });

  it("is a no-op for an AWS env (app-dev/prod resolve from Secrets Manager)", () => {
    writeEnv("from-file");
    loadLocalEnv("app-dev", tmpDir);
    expect(process.env[KEY]).toBeUndefined();
    loadLocalEnv("prod", tmpDir);
    expect(process.env[KEY]).toBeUndefined();
  });

  it("does not override an already-set var (explicit export wins)", () => {
    process.env[KEY] = "preset";
    writeEnv("from-file");
    loadLocalEnv("local", tmpDir);
    expect(process.env[KEY]).toBe("preset");
  });

  it("is a silent no-op when the .env file is absent", () => {
    expect(() => loadLocalEnv("local", tmpDir)).not.toThrow();
    expect(process.env[KEY]).toBeUndefined();
  });

  it("is a silent no-op for an unknown env name", () => {
    writeEnv("from-file");
    expect(() => loadLocalEnv("nope-not-an-env", tmpDir)).not.toThrow();
    expect(process.env[KEY]).toBeUndefined();
  });
});
