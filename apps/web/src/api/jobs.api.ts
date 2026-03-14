import type {
  JobListRequestQuery,
  JobListResponsePayload,
  JobGetResponsePayload,
  JobCreateRequestBody,
  JobCreateResponsePayload,
  JobCancelResponsePayload,
} from "@portalai/core/contracts";

import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const jobs = {
  list: (
    params?: JobListRequestQuery,
    options?: QueryOptions<JobListResponsePayload>
  ) =>
    useAuthQuery<JobListResponsePayload>(
      queryKeys.jobs.list(params),
      buildUrl("/api/jobs", params),
      undefined,
      options
    ),

  get: (id: string, options?: QueryOptions<JobGetResponsePayload>) =>
    useAuthQuery<JobGetResponsePayload>(
      queryKeys.jobs.get(id),
      buildUrl(`/api/jobs/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  create: () =>
    useAuthMutation<JobCreateResponsePayload, JobCreateRequestBody>({
      url: "/api/jobs",
    }),

  cancel: (id: string) =>
    useAuthMutation<JobCancelResponsePayload, void>({
      url: `/api/jobs/${encodeURIComponent(id)}/cancel`,
    }),
};
