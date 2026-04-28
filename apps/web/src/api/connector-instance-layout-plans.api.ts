import type {
  CommitLayoutPlanRequestBody,
  InterpretRequestBody,
  InterpretResponsePayload,
  LayoutPlanCommitResult,
  LayoutPlanResponsePayload,
  PatchLayoutPlanBody,
} from "@portalai/core/contracts";

import { useAuthMutation, useAuthQuery } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

const base = (connectorInstanceId: string) =>
  `/api/connector-instances/${encodeURIComponent(connectorInstanceId)}/layout-plan`;

export const connectorInstanceLayoutPlans = {
  interpret: (connectorInstanceId: string) =>
    useAuthMutation<InterpretResponsePayload, InterpretRequestBody>({
      url: `${base(connectorInstanceId)}/interpret`,
    }),

  getCurrent: (
    connectorInstanceId: string,
    params?: { include?: string },
    options?: QueryOptions<LayoutPlanResponsePayload>
  ) =>
    useAuthQuery<LayoutPlanResponsePayload>(
      queryKeys.connectorInstanceLayoutPlans.detail(connectorInstanceId),
      buildUrl(base(connectorInstanceId), params),
      undefined,
      options
    ),

  patch: (connectorInstanceId: string, planId: string) =>
    useAuthMutation<LayoutPlanResponsePayload, PatchLayoutPlanBody>({
      url: `${base(connectorInstanceId)}/${encodeURIComponent(planId)}`,
      method: "PATCH",
    }),

  commit: (connectorInstanceId: string, planId: string) =>
    useAuthMutation<LayoutPlanCommitResult, CommitLayoutPlanRequestBody>({
      url: `${base(connectorInstanceId)}/${encodeURIComponent(planId)}/commit`,
    }),
};
