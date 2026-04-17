import type {
  PresignRequestBody,
  PresignResponsePayload,
  ProcessResponsePayload,
  ConfirmRequestBody,
  ConfirmResponsePayload,
} from "@portalai/core/contracts";

import { useAuthMutation } from "../utils/api.util";

export const uploads = {
  presign: () =>
    useAuthMutation<PresignResponsePayload, PresignRequestBody>({
      url: "/api/uploads/presign",
    }),

  process: () =>
    useAuthMutation<ProcessResponsePayload, { jobId: string }>({
      url: ({ jobId }) => `/api/uploads/${encodeURIComponent(jobId)}/process`,
      body: () => undefined,
    }),

  confirm: (jobId: string) =>
    useAuthMutation<ConfirmResponsePayload, ConfirmRequestBody>({
      url: `/api/uploads/${encodeURIComponent(jobId)}/confirm`,
    }),
};
