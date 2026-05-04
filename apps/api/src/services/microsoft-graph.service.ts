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
const GRAPH_PAGE_SIZE = 200;
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Recursion depth and total-item caps for `searchWorkbooks`. OneDrive
 * Personal's search index is unreliable (frequently returns 0 results
 * for files that exist), so we enumerate the drive instead and apply
 * the user's typed query as a substring filter on filenames.
 *
 * - Depth 3 covers `/Folder/Subfolder/Sub-subfolder/file.xlsx`.
 * - Max items returned is 25 (the dropdown's display cap) so a deep
 *   drive doesn't overflow the response.
 * - The walk short-circuits once `MAX_NODES_VISITED` items have been
 *   examined to bound API cost on enormous drives.
 */
const ENUMERATION_MAX_DEPTH = 3;
const ENUMERATION_MAX_RESULTS = 25;
const ENUMERATION_MAX_NODES_VISITED = 2000;

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
  folder?: { childCount?: number };
  lastModifiedDateTime?: string;
  lastModifiedBy?: { user?: { displayName?: string; email?: string } };
}

interface GraphChildrenResponse {
  value?: GraphDriveItem[];
  ["@odata.nextLink"]?: string;
}

type FetchFn = typeof fetch;

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

function nameMatchesQuery(name: string, query: string): boolean {
  if (!query) return true;
  return name.toLowerCase().includes(query.toLowerCase());
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}

export class MicrosoftGraphService {
  /**
   * List the user's `.xlsx` workbooks, optionally filtered by a
   * filename substring.
   *
   * **Why enumeration instead of `/me/drive/search(q=…)`.** OneDrive
   * Personal's search index is unreliable: it returns 0 hits for files
   * that exist, ranks by content relevance rather than filename, and
   * silently drops most files in the drive. We hit recursive
   * `/children` listings instead and do the substring match in code,
   * which is predictable across personal + business OneDrive and matches
   * the user's expectation that "search" means "filter by filename".
   *
   * Walk shape: BFS from `/me/drive/root/children`, descending up to
   * `ENUMERATION_MAX_DEPTH` levels. Each `.xlsx` whose name contains
   * the query is collected; the walk short-circuits once
   * `ENUMERATION_MAX_RESULTS` matches are found or
   * `ENUMERATION_MAX_NODES_VISITED` items have been examined.
   *
   * Sorted by `lastModifiedDateTime` desc so the most recently edited
   * workbooks float to the top of the dropdown.
   */
  static async searchWorkbooks(
    accessToken: string,
    query: string,
    fetchFn: FetchFn = fetch
  ): Promise<MicrosoftGraphWorkbookListItem[]> {
    const trimmedQuery = query.trim();
    const matches: MicrosoftGraphWorkbookListItem[] = [];
    const queue: Array<{ folderId: string; depth: number }> = [
      { folderId: "root", depth: 0 },
    ];
    let visited = 0;

    while (queue.length > 0) {
      if (matches.length >= ENUMERATION_MAX_RESULTS) break;
      if (visited >= ENUMERATION_MAX_NODES_VISITED) break;

      const next = queue.shift();
      if (!next) break;
      const { folderId, depth } = next;

      let nextLink: string | null =
        `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(
          folderId
        )}/children?$top=${GRAPH_PAGE_SIZE}&$select=id,name,file,folder,lastModifiedDateTime,lastModifiedBy`;

      while (nextLink) {
        if (matches.length >= ENUMERATION_MAX_RESULTS) break;
        if (visited >= ENUMERATION_MAX_NODES_VISITED) break;

        const res = await fetchFn(nextLink, {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          const body = await safeReadText(res);
          throw new MicrosoftGraphError(
            "search_failed",
            `Microsoft Graph children failed (${res.status}): ${body}`
          );
        }
        const json = (await res.json()) as GraphChildrenResponse;
        for (const item of json.value ?? []) {
          visited++;
          if (item.folder) {
            if (depth + 1 < ENUMERATION_MAX_DEPTH && item.id) {
              queue.push({ folderId: item.id, depth: depth + 1 });
            }
            continue;
          }
          if (!isXlsxItem(item)) continue;
          if (!nameMatchesQuery(item.name as string, trimmedQuery)) continue;
          matches.push(mapItem(item));
          if (matches.length >= ENUMERATION_MAX_RESULTS) break;
        }
        nextLink = json["@odata.nextLink"] ?? null;
      }
    }

    matches.sort((a, b) =>
      b.lastModifiedDateTime.localeCompare(a.lastModifiedDateTime)
    );
    return matches;
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
