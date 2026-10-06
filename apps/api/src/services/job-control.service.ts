/**
 * #689: who controls a job. One rule, used wherever it's decided:
 * - the cancel route (`POST /api/jobs/:id/cancel`, #630),
 * - payload redaction (`JobPayloadRedactionService`, #692),
 * - the `capabilities` on job payloads, which the UI renders Cancel from.
 *
 * Every member reads every job in the org; control is the job's creator, or a
 * caller with unconditional job control (class `resource.delete` on `job`,
 * owner/admin by default).
 */

import type { ObjectCapabilities } from "@portalai/core/contracts";

import type { PermissionContext } from "./permission.service.js";
import type { PermissionSet } from "./permission-set.js";

export class JobControlService {
  /** The creator, or a caller with unconditional job control. */
  static canControl(
    ctx: PermissionContext,
    set: PermissionSet,
    job: { createdBy: string }
  ): boolean {
    return (
      job.createdBy === ctx.userId ||
      set.can("resource.delete", { type: "job" })
    );
  }

  /**
   * The caller's capabilities on a job they can read. `delete` is cancel;
   * there is no job write route, so `write` is always false.
   */
  static capabilities(
    ctx: PermissionContext,
    set: PermissionSet,
    job: { createdBy: string }
  ): ObjectCapabilities {
    return {
      read: true,
      write: false,
      delete: this.canControl(ctx, set, job),
    };
  }
}
