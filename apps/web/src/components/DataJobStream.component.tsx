import React from "react";

import { TERMINAL_JOB_STATUSES } from "@mcp-ui/core/models";
import type { Job } from "@mcp-ui/core/models";

import { JobStreamState, useJobStream } from "../utils/job-stream.util";

export interface DataJobStreamProps {
  job: Job;
  children: (stream: JobStreamState) => React.ReactNode;
}

export const DataJobStream = ({ job, children }: DataJobStreamProps) => {
  const isLive = !TERMINAL_JOB_STATUSES.includes(job.status);
  const stream = useJobStream(isLive ? job.id : null);
  return <>{children(stream)}</>;
};
