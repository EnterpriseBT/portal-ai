import type {
  FileUploadConfirmRequestBody,
  FileUploadConfirmResponsePayload,
  FileUploadParseSessionRequestBody,
  FileUploadParseSessionResponsePayload,
  FileUploadPresignRequestBody,
  FileUploadPresignResponsePayload,
  FileUploadSheetSliceRequestQuery,
  FileUploadSheetSliceResponsePayload,
} from "@portalai/core/contracts";

import { useAuthMutation } from "../utils/api.util";

/**
 * Streaming upload pipeline:
 *   1. `presign` — mint PUT URLs + DB rows.
 *   2. `putToS3` — browser PUTs bytes directly to S3 via the presigned URL.
 *   3. `confirm` — tell the API the PUT landed; backend HEAD-checks S3.
 *   4. `parse`   — server streams every confirmed upload from S3, merges
 *                  sheets, caches the parsed workbook, returns a preview.
 */
export const fileUploads = {
  presign: () =>
    useAuthMutation<
      FileUploadPresignResponsePayload,
      FileUploadPresignRequestBody
    >({ url: "/api/file-uploads/presign" }),

  confirm: () =>
    useAuthMutation<
      FileUploadConfirmResponsePayload,
      FileUploadConfirmRequestBody
    >({ url: "/api/file-uploads/confirm" }),

  parse: () =>
    useAuthMutation<
      FileUploadParseSessionResponsePayload,
      FileUploadParseSessionRequestBody
    >({ url: "/api/file-uploads/parse" }),

  /**
   * Imperative GET for a cell rectangle on a previously-parsed sheet. Called
   * by the region-editor canvas as the viewport scrolls over sheets whose
   * cells were not inlined in the parse response. The caller coalesces /
   * caches rectangles itself — the (session, sheet, rect) keyspace is
   * unbounded, so react-query's key-based cache is not a good fit.
   */
  sheetSlice: () =>
    useAuthMutation<
      FileUploadSheetSliceResponsePayload,
      FileUploadSheetSliceRequestQuery
    >({
      url: (vars) => {
        const params = new URLSearchParams({
          uploadSessionId: vars.uploadSessionId,
          sheetId: vars.sheetId,
          rowStart: String(vars.rowStart),
          rowEnd: String(vars.rowEnd),
          colStart: String(vars.colStart),
          colEnd: String(vars.colEnd),
        });
        return `/api/file-uploads/sheet-slice?${params.toString()}`;
      },
      method: "GET",
      body: () => undefined,
    }),
};

export interface PutToS3Options {
  /**
   * Called on each XHR `upload.progress` event. `total` may be 0 when the
   * server doesn't advertise a size; callers should guard before dividing.
   */
  onProgress?: (loaded: number, total: number) => void;
  /** Abort the PUT mid-stream. The returned promise rejects with AbortError. */
  signal?: AbortSignal;
}

/**
 * PUT a File directly to a presigned S3 URL via XHR — presigned URLs are
 * bearer-less, so this doesn't go through `useAuthFetch`. XHR is used
 * instead of `fetch` because it exposes real upload-progress events.
 */
export async function putToS3(
  file: File,
  putUrl: string,
  options: PutToS3Options = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", putUrl, true);
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);

    if (options.onProgress) {
      const onProgress = options.onProgress;
      xhr.upload.addEventListener("progress", (e) => {
        onProgress(e.loaded, e.lengthComputable ? e.total : file.size);
      });
    }

    const signal = options.signal;
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        reject(new DOMException("PUT aborted", "AbortError"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => xhr.abort(),
        { once: true }
      );
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`S3 PUT failed for ${file.name}: HTTP ${xhr.status}`));
      }
    });
    xhr.addEventListener("error", () => {
      reject(new Error(`Network error uploading ${file.name}`));
    });
    xhr.addEventListener("abort", () => {
      reject(new DOMException("PUT aborted", "AbortError"));
    });

    xhr.send(file);
  });
}
