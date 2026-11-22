/**
 * The shared harness for the org-deleting operator scripts (#1035, #1088):
 * `db:org:delete` and `db:demo:delete`. Each parses `--org <id> --actor <who>`,
 * runs its deletion, and prints one JSON line on success or the reason on
 * stderr with exit 1. The CLI runs them as a local spawn (`--env local`) or
 * as an ECS one-off in the env's API task, which reads the stderr lines back
 * from CloudWatch, so a refusal must be readable as plain lines.
 */
import { pathToFileURL } from "node:url";

import { ApiError } from "../services/http.service.js";
import { closeDatabase } from "./client.js";
import { parseFlags } from "./script-args.util.js";

export interface DeleteScriptIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export const processIo: DeleteScriptIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

export type DeleteStep = (orgId: string, actor: string) => Promise<void>;

/**
 * A failure as the operator should read it. A job-lock refusal names each
 * job that blocks it (#1088 review), so the operator can wait for it or
 * cancel it without looking it up.
 */
export function deleteFailureLines(error: unknown): string[] {
  if (!(error instanceof Error)) return [String(error)];
  const running =
    error instanceof ApiError ? error.details?.runningJobs : undefined;
  if (!Array.isArray(running) || running.length === 0) return [error.message];
  return [
    `${error.message}:`,
    ...running.map(
      (job: { id?: unknown; type?: unknown; status?: unknown }) =>
        `  ${String(job.type)} ${String(job.id)} (${String(job.status)})`
    ),
  ];
}

/** Parse, delete, report. Returns the exit code. */
export async function runDeleteScript(
  argv: string[],
  usage: string,
  remove: DeleteStep,
  io: DeleteScriptIo
): Promise<number> {
  const args = parseFlags(argv, ["org", "actor"]);
  if (!args.ok) {
    io.err(`${usage} (${args.error})`);
    return 1;
  }
  const { org: orgId, actor } = args.flags;
  if (!orgId || !actor) {
    io.err(`${usage} (--org and --actor are required)`);
    return 1;
  }
  try {
    await remove(orgId, actor);
  } catch (err) {
    for (const line of deleteFailureLines(err)) io.err(line);
    return 1;
  }
  io.out(JSON.stringify({ id: orgId, deleted: true }));
  return 0;
}

/** Run `main` when `moduleUrl` is the entry point, then close the pool and
 *  exit with its code. */
export function runIfMain(
  moduleUrl: string,
  main: (argv: string[]) => Promise<number>
): void {
  if (!process.argv[1] || moduleUrl !== pathToFileURL(process.argv[1]).href) {
    return;
  }
  main(process.argv.slice(2))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    })
    .then(async (code) => {
      await closeDatabase().catch(() => {});
      process.exit(code);
    });
}
