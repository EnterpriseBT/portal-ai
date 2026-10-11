import { ApiCode } from "../constants/api-codes.constants.js";
import { ApiError } from "../services/http.service.js";
import type {
  WideTableRejection,
  WideTableUpsertResult,
} from "../db/repositories/wide-table.repository.js";

/**
 * #757: how much of a refused batch a 400 echoes. Like #745's caps, the
 * response can't scale with the request: an import of 10,000 bad rows names
 * the first few and carries the total.
 */
export const MAX_ECHOED_REJECTIONS = 20;
export const MAX_ECHOED_SOURCE_ID_LENGTH = 64;

const clip = (s: string): string =>
  s.length > MAX_ECHOED_SOURCE_ID_LENGTH
    ? `${s.slice(0, MAX_ECHOED_SOURCE_ID_LENGTH)}…`
    : s;

const quoteFields = (fields: string[]): string =>
  fields.map((f) => `"${f}"`).join(", ");

const DETAIL: Record<
  WideTableRejection["code"],
  { one: string; many: string }
> = {
  [ApiCode.GEOMETRY_INVALID_ON_IMPORT]: {
    one: "is not a geometry that can be stored (expected a GeoJSON geometry object or null)",
    many: "are not geometries that can be stored (expected a GeoJSON geometry object or null)",
  },
  [ApiCode.GIS_SRID_UNSUPPORTED]: {
    one: "uses a coordinate system (SRID) that isn't supported",
    many: "use a coordinate system (SRID) that isn't supported",
  },
};

/** Every problem on one row, so a fix-and-resubmit doesn't uncover another. */
const describeProblems = (rejection: WideTableRejection): string =>
  rejection.problems
    .map(({ code, fields }, i) => {
      const many = fields.length > 1;
      const label = `${i === 0 ? "F" : "f"}ield${many ? "s" : ""}`;
      return `${label} ${quoteFields(fields)} ${many ? DETAIL[code].many : DETAIL[code].one}`;
    })
    .join("; ");

/**
 * #757: a manual write never commits a record whose wide-table row the
 * geometry audit refused. `upsertMany` skips such rows and reports them,
 * which is right for a sync (no one is there to fix the row) but leaves a
 * manual write with an `entity_records` row no read can find. Call this
 * inside the write's transaction: it throws a 400 naming the field (and, for
 * a batch, the first refused `sourceId`s), and the throw rolls back the
 * insert.
 */
export function assertNoRejectedGeometry(
  result: Pick<WideTableUpsertResult, "rejected">,
  opts: {
    batch?: boolean;
    /** Names a refused row in a batch message (default: its quoted sourceId). */
    describe?: (sourceId: string) => string;
  } = {}
): void {
  const { rejected } = result;
  if (rejected.length === 0) return;

  const first = rejected[0];
  const echoed = rejected.slice(0, MAX_ECHOED_REJECTIONS).map((r) => ({
    sourceId: clip(r.sourceId),
    code: r.code,
    fields: r.fields,
  }));

  let message: string;
  if (opts.batch) {
    const name = opts.describe ?? ((id: string) => `"${clip(id)}"`);
    const listed = rejected
      .slice(0, MAX_ECHOED_REJECTIONS)
      .map((r) => name(r.sourceId))
      .join(", ");
    const more = rejected.length - echoed.length;
    message =
      `${rejected.length} record${rejected.length > 1 ? "s carry" : " carries"} a geometry that can't be written; ` +
      `nothing was written: ${listed}${more > 0 ? ` and ${more} more` : ""}. ` +
      describeProblems(first);
  } else {
    message = describeProblems(first);
  }

  throw new ApiError(400, first.code, message, {
    rejected: echoed,
    rejectedCount: rejected.length,
  });
}
