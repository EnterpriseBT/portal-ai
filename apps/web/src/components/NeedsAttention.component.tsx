import React from "react";

import { CardList, EmptyState, Icon, IconName } from "@portalai/core/ui";

import {
  AttentionJobRowUI,
  type AttentionJob,
} from "./AttentionJobRow.component";

export interface NeedsAttentionUIProps {
  /** Failed, stalled or waiting jobs, most recent first. */
  jobs: AttentionJob[];
}

/**
 * The dashboard's Needs attention (#1123): the jobs waiting on the caller,
 * or "All clear" when there are none.
 */
export const NeedsAttentionUI: React.FC<NeedsAttentionUIProps> = ({ jobs }) => {
  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={<Icon name={IconName.CheckCircle} />}
        title="All clear"
        description="No jobs are failed, stalled or waiting on you."
      />
    );
  }

  return (
    <CardList aria-label="Jobs needing attention">
      {jobs.map((job) => (
        <AttentionJobRowUI key={job.id} job={job} />
      ))}
    </CardList>
  );
};
