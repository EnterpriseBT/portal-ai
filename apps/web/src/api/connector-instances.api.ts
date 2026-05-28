import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import type {
  ApiSuccessResponse,
  ConnectorInstanceApi,
  ConnectorInstanceCreateRequestBody,
  ConnectorInstanceCreateResponsePayload,
  ConnectorInstanceGetResponsePayload,
  ConnectorInstanceImpact,
  ConnectorInstanceListRequestQuery,
  ConnectorInstanceListResponsePayload,
  ConnectorInstanceListWithDefinitionResponsePayload,
  ConnectorInstancePatchRequestBody,
  ConnectorInstanceRunningJobsResponse,
} from "@portalai/core/contracts";

/** Response shape from `POST /api/connector-instances/:id/sync`. */
export interface ConnectorInstanceSyncResponsePayload {
  jobId: string;
}

/**
 * Body shape for `POST /api/connector-instances/:id/test-connection`.
 * Adapter-specific — REST API reads `endpointEntityId`; other adapters
 * may ignore it or interpret different keys. The shape is intentionally
 * loose; the route forwards the body verbatim to the adapter.
 */
export interface TestConnectionRequestBody {
  endpointEntityId?: string;
  [key: string]: unknown;
}

/**
 * Result shape returned by the adapter and surfaced as the 200 body of
 * the test-connection route — `ok: false` is a *successful* invocation
 * of a check that itself reported failure, not an HTTP-level error.
 */
export type TestConnectionResult =
  | { ok: true; sample: unknown[] }
  | {
      ok: false;
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };
import { useInfiniteFilterOptions } from "@portalai/core/ui";
import type {
  InfiniteFilterOptionsConfig,
  SelectOption,
} from "@portalai/core/ui";
import {
  useAuthQuery,
  useAuthMutation,
  useAuthFetch,
  type ApiError,
} from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions, SearchHookOptions, SearchResult } from "./types";

const CONNECTOR_INSTANCES_URL = "/api/connector-instances";

const defaultMapItem = (instance: ConnectorInstanceApi): SelectOption => ({
  value: instance.id,
  label: instance.name,
});

const CONNECTOR_INSTANCE_FILTER_BASE = {
  url: CONNECTOR_INSTANCES_URL,
  getItems: (res: ApiSuccessResponse<ConnectorInstanceListResponsePayload>) =>
    res.payload.connectorInstances,
  getTotal: (res: ApiSuccessResponse<ConnectorInstanceListResponsePayload>) =>
    res.payload.total,
  mapItem: (instance: ConnectorInstanceApi) => ({
    value: instance.id,
    label: instance.name,
  }),
  sortBy: "name",
} as const;

export const connectorInstances = {
  list: (
    params?: ConnectorInstanceListRequestQuery,
    options?: QueryOptions<ConnectorInstanceListResponsePayload>
  ) =>
    useAuthQuery<ConnectorInstanceListResponsePayload>(
      queryKeys.connectorInstances.list(params),
      buildUrl(CONNECTOR_INSTANCES_URL, params),
      undefined,
      options
    ),

  listWithDefinition: (
    params?: ConnectorInstanceListRequestQuery,
    options?: QueryOptions<ConnectorInstanceListWithDefinitionResponsePayload>
  ) =>
    useAuthQuery<ConnectorInstanceListWithDefinitionResponsePayload>(
      queryKeys.connectorInstances.list(params),
      buildUrl(CONNECTOR_INSTANCES_URL, {
        ...params,
        include: "connectorDefinition",
      }),
      undefined,
      options
    ),

  get: (
    id: string,
    options?: QueryOptions<ConnectorInstanceGetResponsePayload>
  ) =>
    useAuthQuery<ConnectorInstanceGetResponsePayload>(
      queryKeys.connectorInstances.get(id),
      buildUrl(`${CONNECTOR_INSTANCES_URL}/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  impact: (id: string, options?: QueryOptions<ConnectorInstanceImpact>) =>
    useAuthQuery<ConnectorInstanceImpact>(
      queryKeys.connectorInstances.impact(id),
      buildUrl(`${CONNECTOR_INSTANCES_URL}/${encodeURIComponent(id)}/impact`),
      undefined,
      options
    ),

  /**
   * Non-terminal jobs locking this instance — drives the
   * <ConnectorInstanceLockChip> + disabled mutation buttons on the
   * connector-instance detail view. Frontend invalidates this key on
   * the SSE terminal event for any of the listed jobs (see
   * `ConnectorInstance.view.tsx`).
   */
  runningJobs: (
    id: string,
    options?: QueryOptions<ConnectorInstanceRunningJobsResponse>
  ) =>
    useAuthQuery<ConnectorInstanceRunningJobsResponse>(
      queryKeys.connectorInstances.runningJobs(id),
      buildUrl(
        `${CONNECTOR_INSTANCES_URL}/${encodeURIComponent(id)}/running-jobs`
      ),
      undefined,
      options
    ),

  create: () =>
    useAuthMutation<
      ConnectorInstanceCreateResponsePayload,
      ConnectorInstanceCreateRequestBody
    >({
      url: CONNECTOR_INSTANCES_URL,
      method: "POST",
    }),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `${CONNECTOR_INSTANCES_URL}/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),

  rename: (id: string) =>
    useAuthMutation<ConnectorInstanceGetResponsePayload, { name: string }>({
      url: `${CONNECTOR_INSTANCES_URL}/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  update: (id: string) =>
    useAuthMutation<
      ConnectorInstanceGetResponsePayload,
      ConnectorInstancePatchRequestBody
    >({
      url: `${CONNECTOR_INSTANCES_URL}/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  /**
   * Trigger a manual sync for a sync-capable connector instance.
   *
   * Connector-agnostic: the API resolves the appropriate adapter
   * (gsheets today, future Microsoft Excel, future SQL/database, etc.)
   * via the connector definition slug and dispatches its `syncInstance`
   * pipeline. The route is fast-return — it enqueues a `connector_sync`
   * BullMQ job and replies with the `{ jobId }` so the caller can
   * subscribe to its SSE event stream via `sdk.jobs.stream(jobId)` for
   * live progress.
   *
   * On 409 `SYNC_ALREADY_RUNNING`, the in-flight jobId is returned in
   * `error.details.jobId` — UIs should latch onto that stream rather
   * than show an error to the user.
   *
   * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-D.plan.md` §Slice 6.
   */
  sync: (id: string) =>
    useAuthMutation<ConnectorInstanceSyncResponsePayload, void>({
      url: `${CONNECTOR_INSTANCES_URL}/${encodeURIComponent(id)}/sync`,
      method: "POST",
    }),

  /**
   * Same wire shape as `sync`, but the instanceId is a mutation variable
   * instead of being bound at hook-mount time. Used by workflows that
   * need to kick an initial sync immediately after creating the
   * connector instance (where the id isn't known when the hook mounts).
   */
  syncForInstance: () =>
    useAuthMutation<
      ConnectorInstanceSyncResponsePayload,
      { instanceId: string }
    >({
      url: (vars) =>
        `${CONNECTOR_INSTANCES_URL}/${encodeURIComponent(vars.instanceId)}/sync`,
      method: "POST",
    }),

  /**
   * Dry-run an adapter's `testConnection` against a configured instance.
   * Returns `{ ok: true, sample }` on success or `{ ok: false, code, ... }`
   * on failure — both shapes arrive as HTTP 200, since `ok: false`
   * represents a successful invocation of a check that itself reported
   * failure (only network errors and 404s leak as ApiError).
   *
   * Read-only — no cache invalidation; the route doesn't mutate state.
   */
  testConnection: (id: string) =>
    useAuthMutation<TestConnectionResult, TestConnectionRequestBody>({
      url: `${CONNECTOR_INSTANCES_URL}/${encodeURIComponent(id)}/test-connection`,
      method: "POST",
    }),

  search: <TOption extends SelectOption = SelectOption>(
    options?: SearchHookOptions<ConnectorInstanceApi, TOption>
  ): SearchResult<TOption> => {
    const { fetchWithAuth } = useAuthFetch();
    const mapFn = (options?.mapItem ?? defaultMapItem) as (
      item: ConnectorInstanceApi
    ) => TOption;
    const [labelMap, setLabelMap] = useState<Record<string, string>>({});

    const searchMutation = useMutation<TOption[], ApiError, string>({
      mutationFn: async (query: string) => {
        const params: Record<string, string> = { ...options?.defaultParams };
        if (query) params.search = query;
        const res = await fetchWithAuth<
          ApiSuccessResponse<ConnectorInstanceListResponsePayload>
        >(buildUrl(CONNECTOR_INSTANCES_URL, params));
        const mapped = res.payload.connectorInstances.map(mapFn);
        setLabelMap((prev) => {
          const next = { ...prev };
          for (const opt of mapped) next[String(opt.value)] = opt.label;
          return next;
        });
        return mapped;
      },
    });

    const getByIdMutation = useMutation<TOption | null, ApiError, string>({
      mutationFn: async (id: string) => {
        const res = await fetchWithAuth<
          ApiSuccessResponse<ConnectorInstanceGetResponsePayload>
        >(`${CONNECTOR_INSTANCES_URL}/${encodeURIComponent(id)}`);
        const option = mapFn(
          res.payload.connectorInstance as unknown as ConnectorInstanceApi
        );
        setLabelMap((prev) => ({
          ...prev,
          [String(option.value)]: option.label,
        }));
        return option;
      },
    });

    return {
      onSearch: searchMutation.mutateAsync,
      onSearchPending: searchMutation.isPending,
      onSearchError: searchMutation.error,
      getById: getByIdMutation.mutateAsync,
      getByIdPending: getByIdMutation.isPending,
      getByIdError: getByIdMutation.error,
      labelMap,
    };
  },

  filter: () => {
    const { fetchWithAuth } = useAuthFetch();

    const config: InfiniteFilterOptionsConfig<
      ApiSuccessResponse<ConnectorInstanceListResponsePayload>,
      ConnectorInstanceApi
    > = {
      ...CONNECTOR_INSTANCE_FILTER_BASE,
      fetcher: fetchWithAuth,
    };

    return useInfiniteFilterOptions(config);
  },
};
