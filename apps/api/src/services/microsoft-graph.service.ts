/**
 * Microsoft Graph client for the microsoft-excel connector.
 *
 * Three responsibilities, each independently unit-tested:
 *   - `searchWorkbooks` — `/me/drive/search(q='…')` (or `/me/drive/recent`
 *     when the query is empty), post-filtered to `.xlsx` mime+extension.
 *   - `headWorkbook` — read `{ size, name }` BEFORE the download so we
 *     can refuse oversized files cheaply.
 *   - `downloadWorkbook` — stream `/me/drive/items/{id}/content`. If
 *     the response's `Content-Length` exceeds `UPLOAD_MAX_FILE_SIZE_BYTES`,
 *     cancel the stream and throw `file_too_large` BEFORE any bytes are
 *     consumed.
 *
 * The cap is shared with the file-upload pipeline
 * (`UPLOAD_MAX_FILE_SIZE_BYTES`) — same `xlsx.adapter` parsing surface,
 * same memory profile, same configurable ceiling.
 */

import type { Readable } from "stream";
import { Readable as NodeReadable } from "stream";

import { environment } from "../environment.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_PAGE_SIZE = 25;
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type MicrosoftGraphErrorKind =
  | "search_failed"
  | "head_failed"
  | "download_failed"
  | "file_too_large";

export class MicrosoftGraphError extends Error {
  override readonly name = "MicrosoftGraphError" as const;
  readonly kind: MicrosoftGraphErrorKind;
  readonly details?: Record<string, unknown>;

  constructor(
    kind: MicrosoftGraphErrorKind,
    message?: string,
    details?: Record<string, unknown>
  ) {
    super(message ?? kind);
    this.kind = kind;
    if (details) this.details = details;
  }
}

export interface MicrosoftGraphWorkbookListItem {
  driveItemId: string;
  name: string;
  lastModifiedDateTime: string;
  lastModifiedBy: string | null;
}

export interface MicrosoftGraphHeadResult {
  size: number;
  name: string;
}

export interface MicrosoftGraphDownloadResult {
  /** Web `ReadableStream` from `fetch.body`. Convertible to a Node
   *  `Readable` via `MicrosoftGraphService.toNodeReadable` for callers
   *  (exceljs) that need the Node API. */
  stream: ReadableStream<Uint8Array>;
  /** Bytes per the `Content-Length` header (or 0 when not present). */
  contentLength: number;
}

interface GraphDriveItem {
  id?: string;
  name?: string;
  size?: number;
  file?: { mimeType?: string };
  folder?: unknown;
  lastModifiedDateTime?: string;
  lastModifiedBy?: { user?: { displayName?: string; email?: string } };
}

interface GraphSearchResponse {
  value?: GraphDriveItem[];
}

type FetchFn = typeof fetch;

/**
 * OData escapes single quotes in string literals by doubling them.
 * Without this, a query containing `'` corrupts the predicate.
 */
function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

function isXlsxItem(item: GraphDriveItem): boolean {
  if (item.folder) return false;
  if (item.file?.mimeType !== XLSX_MIME) return false;
  if (typeof item.name !== "string") return false;
  return item.name.toLowerCase().endsWith(".xlsx");
}

function mapItem(item: GraphDriveItem): MicrosoftGraphWorkbookListItem {
  return {
    driveItemId: item.id as string,
    name: item.name as string,
    lastModifiedDateTime: item.lastModifiedDateTime ?? "",
    lastModifiedBy: item.lastModifiedBy?.user?.displayName ?? null,
  };
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}

export class MicrosoftGraphService {
  static async searchWorkbooks(
    accessToken: string,
    query: string,
    fetchFn: FetchFn = fetch
  ): Promise<MicrosoftGraphWorkbookListItem[]> {
    const trimmed = query.trim();
    const url =
      trimmed.length === 0
        ? `${GRAPH_BASE}/me/drive/recent?$top=${GRAPH_PAGE_SIZE}&$select=id,name,file,folder,lastModifiedDateTime,lastModifiedBy`
        : `${GRAPH_BASE}/me/drive/search(q='${escapeOData(
            trimmed
          )}')?$top=${GRAPH_PAGE_SIZE}&$select=id,name,file,folder,lastModifiedDateTime,lastModifiedBy`;

    const res = await fetchFn(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await safeReadText(res);
      throw new MicrosoftGraphError(
        "search_failed",
        `Microsoft Graph search failed (${res.status}): ${body}`
      );
    }
    const json = (await res.json()) as GraphSearchResponse;
    return (json.value ?? []).filter(isXlsxItem).map(mapItem);
  }

  static async headWorkbook(
    accessToken: string,
    driveItemId: string,
    fetchFn: FetchFn = fetch
  ): Promise<MicrosoftGraphHeadResult> {
    const url = `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(
      driveItemId
    )}?$select=size,name`;
    const res = await fetchFn(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await safeReadText(res);
      throw new MicrosoftGraphError(
        "head_failed",
        `Microsoft Graph head failed (${res.status}): ${body}`
      );
    }
    const json = (await res.json()) as { size?: number; name?: string };
    return {
      size: typeof json.size === "number" ? json.size : 0,
      name: typeof json.name === "string" ? json.name : "",
    };
  }

  /**
   * Stream `/me/drive/items/{id}/content`. The response's `Content-Length`
   * is checked BEFORE the body is consumed; oversized responses have
   * their stream `cancel`ed and throw `file_too_large`. Callers that
   * need a Node stream pipe through `toNodeReadable`.
   */
  static async downloadWorkbook(
    accessToken: string,
    driveItemId: string,
    fetchFn: FetchFn = fetch
  ): Promise<MicrosoftGraphDownloadResult> {
    const url = `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(
      driveItemId
    )}/content`;
    const res = await fetchFn(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await safeReadText(res);
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      throw new MicrosoftGraphError(
        "download_failed",
        `Microsoft Graph download failed (${res.status}): ${body}`
      );
    }

    const cap = environment.UPLOAD_MAX_FILE_SIZE_BYTES;
    const lengthHeader = res.headers.get("Content-Length");
    const contentLength = lengthHeader ? parseInt(lengthHeader, 10) : 0;

    if (contentLength > 0 && contentLength > cap) {
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      throw new MicrosoftGraphError(
        "file_too_large",
        `Workbook exceeds the configured byte cap (${contentLength} > ${cap})`,
        { sizeBytes: contentLength, capBytes: cap }
      );
    }

    if (!res.body) {
      throw new MicrosoftGraphError(
        "download_failed",
        "Microsoft Graph download returned no response body"
      );
    }

    return { stream: res.body, contentLength };
  }

  /** Web → Node stream conversion for exceljs and other Node-stream
   *  consumers. */
  static toNodeReadable(stream: ReadableStream<Uint8Array>): Readable {
    return NodeReadable.fromWeb(stream as never);
  }
}
