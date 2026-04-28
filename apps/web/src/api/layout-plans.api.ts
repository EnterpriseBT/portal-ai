import type {
  LayoutPlanCommitDraftRequestBody,
  LayoutPlanCommitDraftResponsePayload,
  LayoutPlanInterpretDraftRequestBody,
  LayoutPlanInterpretDraftResponsePayload,
} from "@portalai/core/contracts";

import { useAuthMutation } from "../utils/api.util";

/**
 * Instance-less layout-plan flow. Used by "new connector" workflows
 * (FileUploadConnector today) that defer ConnectorInstance creation until
 * the user confirms the review step.
 *
 * - `interpret` is pure compute server-side — nothing is persisted, nothing
 *   to clean up on abort.
 * - `commit` creates the ConnectorInstance + layout plan row + records
 *   atomically; on any server-side failure both rows are rolled back.
 */
export const layoutPlans = {
  interpret: () =>
    useAuthMutation<
      LayoutPlanInterpretDraftResponsePayload,
      LayoutPlanInterpretDraftRequestBody
    >({
      url: "/api/layout-plans/interpret",
    }),

  commit: () =>
    useAuthMutation<
      LayoutPlanCommitDraftResponsePayload,
      LayoutPlanCommitDraftRequestBody
    >({
      url: "/api/layout-plans/commit",
    }),
};
