import type {
  PresignRequestBody,
  PresignResponsePayload,
  ProcessResponsePayload,
} from "@portalai/core/contracts";

import { useAuthMutation } from "../utils/api.util";

export const uploads = {
  presign: () =>
    useAuthMutation<PresignResponsePayload, PresignRequestBody>({
      url: "/api/uploads/presign",
    }),

  process: (jobId: string) =>
    useAuthMutation<ProcessResponsePayload, void>({
      url: `/api/uploads/${encodeURIComponent(jobId)}/process`,
    }),
};
