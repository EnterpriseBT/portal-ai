import type {
  CommitLayoutPlanRequestBody,
  InterpretRequestBody,
  InterpretResponsePayload,
  LayoutPlanCommitResult,
  LayoutPlanEditContextResponsePayload,
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

  /**
   * One-shot bundle for the edit-plan view's mount: current plan, planId,
   * connector definition slug, and a workbook preview. `editable: false`
   * + `reason` when the workbook source is unrecoverable (file-upload
   * connectors whose source files have been swept post-commit) — the
   * view renders a "re-upload" notice instead of mounting the editor.
   */
  getEditContext: (
    connectorInstanceId: string,
    options?: QueryOptions<LayoutPlanEditContextResponsePayload>
  ) =>
    useAuthQuery<LayoutPlanEditContextResponsePayload>(
      queryKeys.connectorInstanceLayoutPlans.editContext(connectorInstanceId),
      `${base(connectorInstanceId)}/edit-context`,
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
