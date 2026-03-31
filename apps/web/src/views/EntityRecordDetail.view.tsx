import React from "react";

import type { ConnectorEntity, EntityRecord } from "@portalai/core/models";
import type {
  ColumnDefinitionSummary,
  ConnectorEntityGetResponsePayload,
  EntityRecordGetResponsePayload,
  EntityGroupMemberWithDetails,
} from "@portalai/core/contracts";
import type { EntityGroup } from "@portalai/core/models";
import { Box, Icon, IconName, PageGrid, PageGridItem, PageHeader, PageSection, Stack, Typography } from "@portalai/core/ui";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import CircularProgress from "@mui/material/CircularProgress";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import StarIcon from "@mui/icons-material/Star";

import { useNavigate } from "@tanstack/react-router";

import { sdk } from "../api/sdk";
import DataResult from "../components/DataResult.component";
import { EntityRecordFieldValue } from "../components/EntityRecordFieldValue.component";
import { EntityRecordMetadata } from "../components/EntityRecordMetadata.component";

// ── Related Records panel (per group) ────────────────────────────────

interface RelatedRecordsGroupPanelProps {
  group: EntityGroup;
  record: EntityRecord;
  connectorEntityId: string;
}

const RelatedRecordsGroupPanel: React.FC<RelatedRecordsGroupPanelProps> = ({
  group,
  record,
  connectorEntityId,
}) => {
  const navigate = useNavigate();

  // Fetch group details (with members) when the panel is expanded
  const groupDetailResult = sdk.entityGroups.get(group.id);

  // Find the current entity's member to determine the link field
  const groupDetail = groupDetailResult.data?.entityGroup;
  const currentMember = groupDetail?.members.find(
    (m: EntityGroupMemberWithDetails) => m.connectorEntityId === connectorEntityId
  );
  const linkFieldKey = currentMember?.linkFieldMappingSourceField;
  const linkValue = linkFieldKey ? String(record.normalizedData[linkFieldKey] ?? "") : "";

  // Resolve identity automatically when linkValue is available
  const resolveResult = sdk.entityGroups.resolve(
    group.id,
    { linkValue },
    { enabled: !!linkValue }
  );

  // Filter out the current record from the resolved results
  const filteredResults = (resolveResult.data?.results ?? [])
    .map((result) => ({
      ...result,
      records: result.records.filter((rec) => rec.id !== record.id),
    }))
    .filter((result) => result.records.length > 0);

  return (
    <Accordion data-testid={`related-records-group-${group.id}`}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle1">{group.name}</Typography>
      </AccordionSummary>
      <AccordionDetails>
        {groupDetailResult.isLoading ? (
          <CircularProgress size={20} />
        ) : !currentMember ? (
          <Typography variant="body2" color="text.secondary">
            Unable to determine link field for this entity.
          </Typography>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Link field: <strong>{linkFieldKey}</strong> = &quot;{linkValue}&quot;
            </Typography>

            {resolveResult.isLoading ? (
              <CircularProgress size={20} />
            ) : filteredResults.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No matching records found
              </Typography>
            ) : (
              <Stack spacing={2}>
                {filteredResults.map((result) => (
                  <Box key={result.connectorEntityId}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                      <Typography
                        variant="body1"
                        sx={{ fontWeight: result.isPrimary ? "bold" : "normal" }}
                      >
                        {result.connectorEntityLabel}
                      </Typography>
                      {result.isPrimary && (
                        <StarIcon
                          fontSize="small"
                          color="warning"
                          data-testid="primary-star-icon"
                        />
                      )}
                      <Chip
                        label={`${result.records.length} record${result.records.length !== 1 ? "s" : ""}`}
                        size="small"
                        variant="outlined"
                      />
                    </Stack>
                    {result.records.map((rec) => (
                      <Box
                        key={rec.id}
                        sx={{
                          pl: 2,
                          py: 0.5,
                          borderLeft: 2,
                          borderColor: "divider",
                          mb: 0.5,
                        }}
                      >
                        <Link
                          component="button"
                          variant="body2"
                          onClick={() =>
                            navigate({
                              to: `/entities/${result.connectorEntityId}/records/${rec.id}`,
                            })
                          }
                          sx={{ cursor: "pointer" }}
                        >
                          Source ID: {rec.sourceId}
                        </Link>
                      </Box>
                    ))}
                  </Box>
                ))}
              </Stack>
            )}
          </Stack>
        )}
      </AccordionDetails>
    </Accordion>
  );
};

// ── Related Records section ──────────────────────────────────────────

interface RelatedRecordsSectionProps {
  groups: EntityGroup[];
  record: EntityRecord;
  connectorEntityId: string;
}

export const RelatedRecordsSection: React.FC<RelatedRecordsSectionProps> = ({
  groups,
  record,
  connectorEntityId,
}) => {
  if (groups.length === 0) return null;

  return (
    <PageSection
      title="Related Records"
      icon={<Icon name={IconName.Link} />}
      data-testid="related-records-section"
    >
      <Stack spacing={1}>
        {groups.map((group) => (
          <RelatedRecordsGroupPanel
            key={group.id}
            group={group}
            record={record}
            connectorEntityId={connectorEntityId}
          />
        ))}
      </Stack>
    </PageSection>
  );
};

// ── Pure UI ──────────────────────────────────────────────────────────

export interface EntityRecordDetailViewUIProps {
  entity: ConnectorEntity;
  record: EntityRecord;
  columns: ColumnDefinitionSummary[];
  groups?: EntityGroup[];
}

export const EntityRecordDetailViewUI: React.FC<EntityRecordDetailViewUIProps> = ({
  entity,
  record,
  columns,
  groups = [],
}) => {
  const navigate = useNavigate();

  return (
    <Box>
      <Stack spacing={4}>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "Entities", href: "/entities" },
            { label: entity.label, href: `/entities/${entity.id}` },
            { label: `Record ${record.sourceId}` },
          ]}
          onNavigate={(href) => navigate({ to: href })}
          title="Record Details"
          icon={<Icon name={IconName.DataObject} />}
        />
        <PageGrid columns={{ xs: 1, md: 2 }}>
          {/* Metadata */}
          <PageGridItem>
            <PageSection title="Metadata" variant="outlined">
              <EntityRecordMetadata record={record} />
              {groups.length > 0 && (
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: { xs: "column", sm: "row" },
                    gap: { xs: 0.5, sm: 2 },
                    alignItems: "flex-start",
                    mt: 1.5,
                  }}
                  data-testid="entity-groups-metadata"
                >
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ minWidth: 160, flexShrink: 0 }}
                  >
                    Entity Groups
                  </Typography>
                  <Box sx={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 1 }}>
                    {groups.map((g) => (
                      <Link
                        key={g.id}
                        component="button"
                        variant="body2"
                        onClick={() => navigate({ to: `/entity-groups/${g.id}` })}
                        sx={{ cursor: "pointer" }}
                      >
                        {g.name}
                      </Link>
                    ))}
                  </Box>
                </Box>
              )}
            </PageSection>
          </PageGridItem>

          {/* Fields */}
          <PageGridItem span={{ xs: 1, md: 2 }}>
            <PageSection title="Fields" variant="outlined">
              <Stack spacing={2}>
                {columns.map((col) => (
                  <Box
                    key={col.key}
                    sx={{
                      display: "flex",
                      flexDirection: { xs: "column", sm: "row" },
                      gap: { xs: 0.5, sm: 2 },
                      alignItems: "flex-start",
                    }}
                  >
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ minWidth: 200, flexShrink: 0 }}
                    >
                      {col.label}
                    </Typography>
                    <EntityRecordFieldValue
                      value={record.normalizedData[col.key]}
                      type={col.type}
                    />
                  </Box>
                ))}
              </Stack>
            </PageSection>
          </PageGridItem>

          {/* Related Records */}
          <PageGridItem span={{ xs: 1, md: 2 }}>
            <RelatedRecordsSection
              groups={groups}
              record={record}
              connectorEntityId={entity.id}
            />
          </PageGridItem>
        </PageGrid>
      </Stack>
    </Box>
  );
};

// ── Container ────────────────────────────────────────────────────────

export interface EntityRecordDetailViewProps {
  entityId: string;
  recordId: string;
}

export const EntityRecordDetailView: React.FC<EntityRecordDetailViewProps> = ({
  entityId,
  recordId,
}) => {
  const entityResult = sdk.connectorEntities.get(entityId);
  const recordResult = sdk.entityRecords.get(entityId, recordId);
  const groupsResult = sdk.entityGroups.listByEntity(entityId);

  return (
    <DataResult results={{ entity: entityResult, record: recordResult }}>
      {({
        entity: entityPayload,
        record: recordPayload,
      }: {
        entity: ConnectorEntityGetResponsePayload;
        record: EntityRecordGetResponsePayload;
      }) => (
        <EntityRecordDetailViewUI
          entity={entityPayload.connectorEntity}
          record={recordPayload.record}
          columns={recordPayload.columns}
          groups={groupsResult.data?.entityGroups ?? []}
        />
      )}
    </DataResult>
  );
};
