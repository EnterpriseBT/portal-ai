/**
 * File uploads are the uploader's own (#685). An upload is a staging object
 * (not a policy resource type) on its way to becoming a connector instance,
 * so only the member who uploaded it may confirm it, parse it, or interpret
 * or commit a layout plan from it. Before #685 these routes checked only that
 * the upload was in the caller's org, so a member could parse (and read) or
 * commit another member's file.
 *
 * Anything not the caller's (missing, another org's, another user's) is the
 * same 404 `FILE_UPLOAD_NOT_FOUND`, so an id reveals nothing.
 */

import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import type { PermissionContext } from "./permission.service.js";

const notFound = () =>
  new ApiError(404, ApiCode.FILE_UPLOAD_NOT_FOUND, "Upload not found");

export class FileUploadAccessService {
  /** Every upload id must be the caller's, in the caller's org. */
  static async assertOwnUploads(
    ctx: PermissionContext,
    uploadIds: string[]
  ): Promise<void> {
    for (const id of new Set(uploadIds)) {
      const row = await DbService.repository.fileUploads.findById(id);
      if (
        !row ||
        row.organizationId !== ctx.organizationId ||
        row.createdBy !== ctx.userId
      ) {
        throw notFound();
      }
    }
  }

  /** Every upload in the session must be the caller's, in the caller's org. */
  static async assertOwnUploadSession(
    ctx: PermissionContext,
    uploadSessionId: string
  ): Promise<void> {
    const rows =
      await DbService.repository.fileUploads.findByUploadSessionId(
        uploadSessionId
      );
    if (
      rows.length === 0 ||
      rows.some(
        (r) =>
          r.organizationId !== ctx.organizationId || r.createdBy !== ctx.userId
      )
    ) {
      throw notFound();
    }
  }
}
