/**
 * Repository for the `file_uploads` table — audit + state tracking for the
 * presigned-upload lifecycle introduced by
 * `docs/LARGE_WORKBOOK_STREAMING.plan.md` Phase 0.
 */

import { and, eq, inArray } from "drizzle-orm";

import { fileUploads } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { FileUploadInsert, FileUploadSelect } from "../schema/zod.js";

export type FileUploadStatus =
  | "pending"
  | "uploaded"
  | "parsed"
  | "committed"
  | "failed";

export class FileUploadsRepository extends Repository<
  typeof fileUploads,
  FileUploadSelect,
  FileUploadInsert
> {
  constructor() {
    super(fileUploads);
  }

  /**
   * Look up the rows backing an upload session — the tuple of `uploadIds`
   * grouped by a single parse call. Returned in insertion order so callers
   * can rely on the sheet merge order.
   */
  async findByUploadSessionId(
    uploadSessionId: string,
    client: DbClient = db
  ): Promise<FileUploadSelect[]> {
    return (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(fileUploads.uploadSessionId, uploadSessionId),
          this.notDeleted()
        )
      )
      .orderBy(fileUploads.created);
  }

  /**
   * Transition a row's status + set its `uploadSessionId`. Returns the
   * updated row; throws when the row does not exist.
   */
  async updateStatus(
    id: string,
    status: FileUploadStatus,
    extras: Partial<Pick<FileUploadInsert, "uploadSessionId">> = {},
    client: DbClient = db
  ): Promise<FileUploadSelect | undefined> {
    return this.update(
      id,
      {
        status,
        ...extras,
        updated: Date.now(),
      },
      client
    );
  }

  /**
   * Bulk transition by id. Used by the parse handler to flip all uploads in
   * a session to `"parsed"` in one statement.
   */
  async updateStatusMany(
    ids: string[],
    status: FileUploadStatus,
    extras: Partial<Pick<FileUploadInsert, "uploadSessionId">> = {},
    client: DbClient = db
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.updateWhere(
      inArray(fileUploads.id, ids),
      { status, ...extras, updated: Date.now() },
      client
    );
    return rows.length;
  }
}

export const fileUploadsRepo = new FileUploadsRepository();
