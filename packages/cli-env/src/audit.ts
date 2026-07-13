/**
 * Local audit log (#194 enterprise lens — accuracy & auditability).
 *
 * Every mutating command in the consuming CLIs records who / what / when /
 * which-env as one JSONL line in `~/.portalai/audit.log`. Because the API
 * path uses device-flow USER tokens, agent-driven actions still attribute to
 * the human who authorized the session.
 *
 * Best-effort by contract: an append failure must never block the operation —
 * it logs to stderr and returns.
 */

import fs from "node:fs";
import path from "node:path";

import { portalaiDir } from "./registry.js";

export interface AuditEntry {
  env: string;
  /** Auth0 `sub` when a session exists, else the AWS STS identity, else "unknown". */
  operator: string;
  command: string;
  args?: unknown;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const dir = portalaiDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    fs.appendFileSync(path.join(dir, "audit.log"), `${line}\n`, {
      mode: 0o600,
    });
  } catch (err) {
    console.error(
      `[cli-env] audit append failed (operation proceeds): ${(err as Error)?.message}`
    );
  }
}
