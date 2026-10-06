import type {
  JobListRequestQuery,
  JobListResponsePayload,
  JobGetResponsePayload,
  JobCancelResponsePayload,
} from "@portalai/core/contracts";

import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { useJobStream } from "../utils/job-stream.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export type { JobStreamState } from "../utils/job-stream.util";

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

  cancel: (id: string) =>
    useAuthMutation<JobCancelResponsePayload, void>({
      url: `/api/jobs/${encodeURIComponent(id)}/cancel`,
      // #689: a 403 means the caller no longer controls the job; refetch so
      // Cancel re-renders from fresh capabilities.
      onPermissionDenied: { invalidate: () => [queryKeys.jobs.root] },
    }),

  stream: (jobId: string | null | undefined) => useJobStream(jobId),
};
