import type {
  EntityRecordListRequestQuery,
  EntityRecordListResponsePayload,
  EntityRecordCountResponsePayload,
  EntityRecordImportRequestBody,
  EntityRecordImportResponsePayload,
  EntityRecordSyncResponsePayload,
  EntityRecordDeleteResponsePayload,
  EntityRecordGetResponsePayload,
} from "@portalai/core/contracts";

import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

function recordsUrl(connectorEntityId: string, path = "") {
  return `/api/connector-entities/${encodeURIComponent(connectorEntityId)}/records${path}`;
}

export const entityRecords = {
  list: (
    connectorEntityId: string,
    params?: EntityRecordListRequestQuery,
    options?: QueryOptions<EntityRecordListResponsePayload>
  ) =>
    useAuthQuery<EntityRecordListResponsePayload>(
      queryKeys.entityRecords.list(connectorEntityId, params),
      buildUrl(recordsUrl(connectorEntityId), params),
      undefined,
      options
    ),

  count: (
    connectorEntityId: string,
    options?: QueryOptions<EntityRecordCountResponsePayload>
  ) =>
    useAuthQuery<EntityRecordCountResponsePayload>(
      queryKeys.entityRecords.count(connectorEntityId),
      recordsUrl(connectorEntityId, "/count"),
      undefined,
      options
    ),

  import: (connectorEntityId: string) =>
    useAuthMutation<
      EntityRecordImportResponsePayload,
      EntityRecordImportRequestBody
    >({
      url: recordsUrl(connectorEntityId, "/import"),
    }),

  sync: (connectorEntityId: string) =>
    useAuthMutation<EntityRecordSyncResponsePayload, void>({
      url: recordsUrl(connectorEntityId, "/sync"),
    }),

  clear: (connectorEntityId: string) =>
    useAuthMutation<EntityRecordDeleteResponsePayload, void>({
      url: recordsUrl(connectorEntityId),
      method: "DELETE",
    }),

  get: (
    connectorEntityId: string,
    recordId: string,
    options?: QueryOptions<EntityRecordGetResponsePayload>
  ) =>
    useAuthQuery<EntityRecordGetResponsePayload>(
      queryKeys.entityRecords.get(connectorEntityId, recordId),
      recordsUrl(connectorEntityId, `/${encodeURIComponent(recordId)}`),
      undefined,
      options
    ),

  delete: (connectorEntityId: string, recordId: string) =>
    useAuthMutation<void, void>({
      url: recordsUrl(connectorEntityId, `/${encodeURIComponent(recordId)}`),
      method: "DELETE",
    }),
};
