/**
 * The SSM DB-tunnel primitive (#194, Decisions 5/6) — the shared piece #192
 * consumes. Ports api-cli.sh's tunnel (lines 182-214): resolve the bastion
 * instance id from its CloudFormation export, then spawn
 * `aws ssm start-session` with the port-forward-to-remote-host document.
 *
 * The subprocess is spawned DETACHED in its own process group so close() can
 * terminate the whole tree (the aws CLI execs session-manager-plugin as a
 * child); a process-exit hook prevents orphans if the CLI dies mid-session.
 */

import { spawn } from "node:child_process";

import {
  CloudFormationClient,
  ListExportsCommand,
} from "@aws-sdk/client-cloudformation";

import { EnvInfraError, EnvNotConfiguredError } from "./errors.js";
import { bastionExportName, type EnvironmentDefinition } from "./registry.js";

/** The session-manager-plugin line that signals the port-forward is live. */
export const TUNNEL_READY_MARKER = "Waiting for connections";

const DEFAULT_LOCAL_PORT = 15432;
const READINESS_TIMEOUT_MS = 30_000;

export interface Tunnel {
  localPort: number;
  close(): Promise<void>;
}

export interface OpenDbTunnelOptions {
  /** The remote DB endpoint the bastion forwards to (parsed from the env's
   *  database-url by the caller — connection.ts). */
  remoteHost: string;
  remotePort: number;
  localPort?: number;
}

/** Resolve the bastion EC2 instance id via its CloudFormation export. */
async function resolveBastionInstanceId(
  def: EnvironmentDefinition
): Promise<string> {
  const exportName = bastionExportName(def); // throws ENV_NOT_CONFIGURED for aws:null
  const region = def.aws!.region;
  const client = new CloudFormationClient({ region });
  let exports;
  try {
    exports = (await client.send(new ListExportsCommand({}))).Exports ?? [];
  } catch (err) {
    throw new EnvInfraError(
      `Failed to list CloudFormation exports while resolving the bastion: ${(err as Error)?.message}`,
      { cause: err }
    );
  }
  const match = exports.find((e) => e.Name === exportName);
  if (!match?.Value) {
    throw new EnvInfraError(
      `Bastion export "${exportName}" not found in ${region} — is the bastion stack deployed for "${def.name}"?`
    );
  }
  return match.Value;
}

/**
 * Open the port-forward. Resolves once the plugin reports readiness; rejects
 * (typed) on a missing aws CLI / plugin, an early exit, or a readiness
 * timeout. `close()` terminates the process group and is idempotent.
 */
export async function openDbTunnel(
  def: EnvironmentDefinition,
  opts: OpenDbTunnelOptions
): Promise<Tunnel> {
  if (!def.aws) {
    throw new EnvNotConfiguredError(
      `Environment "${def.name}" has no AWS configuration (local-only)`
    );
  }
  const localPort = opts.localPort ?? DEFAULT_LOCAL_PORT;
  const target = await resolveBastionInstanceId(def);

  const args = [
    "ssm",
    "start-session",
    "--target",
    target,
    "--document-name",
    "AWS-StartPortForwardingSessionToRemoteHost",
    "--parameters",
    JSON.stringify({
      host: [opts.remoteHost],
      portNumber: [String(opts.remotePort)],
      localPortNumber: [String(localPort)],
    }),
    "--region",
    def.aws.region,
  ];

  const child = spawn("aws", args, {
    detached: true, // own process group → close() kills aws + the plugin
    stdio: ["ignore", "pipe", "pipe"],
  });

  let closed = false;
  const killGroup = () => {
    try {
      if (child.pid != null) process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  };

  // Orphan protection. Two distinct death paths need covering (verified in
  // the #194 smoke): normal exits fire "exit", but a default-handled signal
  // (Ctrl+C / SIGTERM) terminates Node WITHOUT firing it — so we also hook
  // the termination signals, clean up, then re-raise so the process still
  // dies with the right status. If the embedding CLI has its own handler for
  // the signal we don't re-raise (its handler owns the shutdown). SIGKILL is
  // unprotectable; the SSM session then times out server-side.
  const onProcessExit = () => {
    if (!closed) killGroup();
  };
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  const detachHooks = () => {
    process.removeListener("exit", onProcessExit);
    for (const [sig, handler] of signalHandlers) {
      process.removeListener(sig, handler);
    }
    signalHandlers.clear();
  };
  process.once("exit", onProcessExit);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as NodeJS.Signals[]) {
    const handler = () => {
      if (!closed) killGroup();
      detachHooks();
      if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
    };
    signalHandlers.set(sig, handler);
    process.once(sig, handler);
  }

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    detachHooks();
    killGroup();
  };

  await new Promise<void>((resolve, reject) => {
    let stderrBuf = "";
    const timer = setTimeout(() => {
      void close();
      reject(
        new EnvInfraError(
          `Tunnel to "${def.name}" did not become ready within ${READINESS_TIMEOUT_MS / 1000}s`
        )
      );
    }, READINESS_TIMEOUT_MS);
    timer.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes(TUNNEL_READY_MARKER)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      void close();
      reject(
        new EnvInfraError(
          err.code === "ENOENT"
            ? "Could not spawn the aws CLI — install the AWS CLI v2 and the session-manager-plugin (https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)"
            : `Failed to start the SSM session: ${err.message}`,
          { cause: err }
        )
      );
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(
        new EnvInfraError(
          `SSM session for "${def.name}" exited (code ${code}) before the tunnel was ready: ${stderrBuf.trim()}`
        )
      );
    });
  });

  return { localPort, close };
}
