import { jest } from "@jest/globals";
import { EventEmitter } from "node:events";

// ── Mocks: CloudFormation export lookup + child_process spawn ────────

const cfnSend = jest.fn<(cmd: unknown) => Promise<unknown>>();
jest.unstable_mockModule("@aws-sdk/client-cloudformation", () => ({
  CloudFormationClient: class {
    send = cfnSend;
  },
  ListExportsCommand: class {
    constructor(public readonly input: unknown) {}
  },
}));

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4242;
  kill = jest.fn();
  unref = jest.fn();
}
let child: FakeChild;
const spawnMock = jest.fn(() => child as unknown);
jest.unstable_mockModule("node:child_process", () => ({
  spawn: spawnMock,
}));

const { openDbTunnel, TUNNEL_READY_MARKER } = await import("../tunnel.js");
const { BUILTIN_ENVIRONMENTS } = await import("../registry.js");
const { EnvInfraError, EnvNotConfiguredError } = await import("../errors.js");

const appDev = BUILTIN_ENVIRONMENTS["app-dev"];
const local = BUILTIN_ENVIRONMENTS["local"];
const REMOTE = { remoteHost: "db.internal", remotePort: 5432 };

const bastionExport = (name: string, value: string) => ({
  Exports: [{ Name: name, Value: value }],
});

beforeEach(() => {
  cfnSend.mockReset();
  spawnMock.mockClear();
  child = new FakeChild();
});

const ready = () =>
  // Emit the plugin's readiness line on the next tick, after openDbTunnel
  // has attached its listeners.
  setImmediate(() => child.stdout.emit("data", Buffer.from(TUNNEL_READY_MARKER)));

describe("openDbTunnel", () => {
  it("resolves the bastion from the CloudFormation export and spawns the SSM port-forward", async () => {
    cfnSend.mockResolvedValue(bastionExport("dev-BastionInstanceId", "i-0abc123"));
    ready();
    const tunnel = await openDbTunnel(appDev, { ...REMOTE, localPort: 15999 });

    expect(tunnel.localPort).toBe(15999);
    const [cmd, args] = spawnMock.mock.calls[0] as unknown as [string, string[]];
    expect(cmd).toBe("aws");
    expect(args).toEqual(
      expect.arrayContaining([
        "ssm",
        "start-session",
        "--target",
        "i-0abc123",
        "--document-name",
        "AWS-StartPortForwardingSessionToRemoteHost",
        "--region",
        "us-east-1",
      ])
    );
    // The document parameters carry remote host/port + the local port.
    const params = args[args.indexOf("--parameters") + 1];
    expect(params).toContain('"host":["db.internal"]');
    expect(params).toContain('"portNumber":["5432"]');
    expect(params).toContain('"localPortNumber":["15999"]');
  });

  it("defaults the local port to 15432", async () => {
    cfnSend.mockResolvedValue(bastionExport("dev-BastionInstanceId", "i-0abc123"));
    ready();
    const tunnel = await openDbTunnel(appDev, REMOTE);
    expect(tunnel.localPort).toBe(15432);
  });

  it("close() terminates the process group (no orphaned plugin)", async () => {
    cfnSend.mockResolvedValue(bastionExport("dev-BastionInstanceId", "i-0abc123"));
    ready();
    const killSpy = jest
      .spyOn(process, "kill")
      .mockImplementation(() => true);
    try {
      const tunnel = await openDbTunnel(appDev, REMOTE);
      await tunnel.close();
      expect(killSpy).toHaveBeenCalledWith(-4242, "SIGTERM");
    } finally {
      killSpy.mockRestore();
    }
  });

  it("hooks termination signals (SIGTERM et al) and removes the hooks on close()", async () => {
    // Node does NOT fire "exit" on a default-handled signal death — the #194
    // smoke caught a SIGTERM'd holder orphaning the tunnel. Pin that signal
    // hooks are registered while open and fully removed after close().
    cfnSend.mockResolvedValue(bastionExport("dev-BastionInstanceId", "i-0abc123"));
    ready();
    const before = {
      exit: process.listenerCount("exit"),
      term: process.listenerCount("SIGTERM"),
      int: process.listenerCount("SIGINT"),
      hup: process.listenerCount("SIGHUP"),
    };
    const killSpy = jest.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const tunnel = await openDbTunnel(appDev, REMOTE);
      expect(process.listenerCount("exit")).toBe(before.exit + 1);
      expect(process.listenerCount("SIGTERM")).toBe(before.term + 1);
      expect(process.listenerCount("SIGINT")).toBe(before.int + 1);
      expect(process.listenerCount("SIGHUP")).toBe(before.hup + 1);
      await tunnel.close();
      expect(process.listenerCount("exit")).toBe(before.exit);
      expect(process.listenerCount("SIGTERM")).toBe(before.term);
      expect(process.listenerCount("SIGINT")).toBe(before.int);
      expect(process.listenerCount("SIGHUP")).toBe(before.hup);
    } finally {
      killSpy.mockRestore();
    }
  });

  it("rejects with ENV_INFRA_ERROR + install guidance when the aws CLI is missing", async () => {
    cfnSend.mockResolvedValue(bastionExport("dev-BastionInstanceId", "i-0abc123"));
    setImmediate(() => {
      const err = new Error("spawn aws ENOENT") as Error & { code?: string };
      err.code = "ENOENT";
      child.emit("error", err);
    });
    const p = openDbTunnel(appDev, REMOTE);
    await expect(p).rejects.toBeInstanceOf(EnvInfraError);
    await expect(p).rejects.toThrow(/session-manager-plugin|aws CLI/i);
  });

  it("rejects with ENV_INFRA_ERROR when the session exits before readiness", async () => {
    cfnSend.mockResolvedValue(bastionExport("dev-BastionInstanceId", "i-0abc123"));
    setImmediate(() => {
      child.stderr.emit("data", Buffer.from("TargetNotConnected"));
      child.emit("exit", 1);
    });
    await expect(openDbTunnel(appDev, REMOTE)).rejects.toMatchObject({
      code: "ENV_INFRA_ERROR",
      message: expect.stringContaining("TargetNotConnected"),
    });
  });

  it("rejects when the bastion export is missing", async () => {
    cfnSend.mockResolvedValue({ Exports: [] });
    await expect(openDbTunnel(appDev, REMOTE)).rejects.toBeInstanceOf(
      EnvInfraError
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("throws ENV_NOT_CONFIGURED for an env without AWS config", async () => {
    await expect(openDbTunnel(local, REMOTE)).rejects.toBeInstanceOf(
      EnvNotConfiguredError
    );
  });
});
