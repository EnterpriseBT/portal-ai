/**
 * REST API connector — endpoint CRUD SDK.
 *
 * Frontend wrapper around `/api/connector-instances/:instanceId/api-endpoints`.
 * Caller composes invalidation via `useQueryClient` per the convention
 * established by `connector-entities.api`.
 */

import type {
  ApiAuthConfig,
  ApiEndpointConfig,
} from "@portalai/core/models";
import type {
  DiscoverColumnsRequestBody,
  DiscoverColumnsResult,
} from "@portalai/core/contracts";
import { useAuthMutation, useAuthQuery } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

// ── Wire shapes ──────────────────────────────────────────────────────

export interface ApiEndpointWire {
  entity: { id: string; key: string; label: string };
  config: ApiEndpointConfig;
}

export interface ApiEndpointsListPayload {
  endpoints: ApiEndpointWire[];
}

export interface CreateApiEndpointBody {
  key: string;
  label: string;
  config: ApiEndpointConfig;
}

export interface PatchApiEndpointBody {
  label?: string;
  config?: Partial<ApiEndpointConfig>;
}

// Re-exported here so consumers don't have to reach into the deeper
// @portalai/core path for the auth shape.
export type { ApiAuthConfig };

// ── URL builders ─────────────────────────────────────────────────────

const baseUrl = (instanceId: string) =>
  `/api/connector-instances/${encodeURIComponent(instanceId)}/api-endpoints`;

// ── SDK surface ──────────────────────────────────────────────────────

export const apiConnector = {
  endpoints: {
    list: (
      instanceId: string,
      options?: QueryOptions<ApiEndpointsListPayload>
    ) =>
      useAuthQuery<ApiEndpointsListPayload>(
        queryKeys.apiEndpoints.byInstance(instanceId),
        baseUrl(instanceId),
        undefined,
        options
      ),

    get: (
      instanceId: string,
      entityId: string,
      options?: QueryOptions<ApiEndpointWire>
    ) =>
      useAuthQuery<ApiEndpointWire>(
        queryKeys.apiEndpoints.byEntity(instanceId, entityId),
        `${baseUrl(instanceId)}/${encodeURIComponent(entityId)}`,
        undefined,
        options
      ),

    create: (instanceId: string) =>
      useAuthMutation<ApiEndpointWire, CreateApiEndpointBody>({
        url: baseUrl(instanceId),
        method: "POST",
      }),

    update: (instanceId: string, entityId: string) =>
      useAuthMutation<ApiEndpointWire, PatchApiEndpointBody>({
        url: `${baseUrl(instanceId)}/${encodeURIComponent(entityId)}`,
        method: "PATCH",
      }),

    delete: (instanceId: string, entityId: string) =>
      useAuthMutation<{ ok: true }, void>({
        url: `${baseUrl(instanceId)}/${encodeURIComponent(entityId)}`,
        method: "DELETE",
      }),

    /**
     * Phase-4 probe entry point: drives a single page-1 fetch + the
     * heuristic + (optional) AI-assist inference pipeline, returns
     * `DiscoverColumnsResult` (columns + samples + suggestions +
     * source + degradation).
     *
     * Read-only — no cache invalidation. The route serves cached
     * results within 60 seconds; `body.forceRefresh: true` busts the
     * cache.
     */
    discoverColumns: (instanceId: string, entityId: string) =>
      useAuthMutation<DiscoverColumnsResult, DiscoverColumnsRequestBody>({
        url: `${baseUrl(instanceId)}/${encodeURIComponent(entityId)}/discover-columns`,
        method: "POST",
      }),
  },
};
