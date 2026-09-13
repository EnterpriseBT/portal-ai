import type {
  AuditLogListRequestQuery,
  AuditLogListResponse,
} from "@portalai/core/contracts";
import { useAuthQuery } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const auditLog = {
  /** Owner-gated security audit trail (#575/#596) — the paginated read behind
   *  `GET /api/organization/audit-log`, filterable by `action`/`outcome`. */
  list: (
    params?: AuditLogListRequestQuery,
    options?: QueryOptions<AuditLogListResponse>
  ) =>
    useAuthQuery<AuditLogListResponse>(
      queryKeys.auditLog.list(params),
      buildUrl("/api/organization/audit-log", params),
      undefined,
      options
    ),
};
