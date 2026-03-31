import React, { useState, useCallback } from "react";

import type { ConnectorEntity, EntityRecord } from "@portalai/core/models";
import type {
  ColumnDefinitionSummary,
  ConnectorEntityGetResponsePayload,
  EntityRecordGetResponsePayload,
  EntityGroupMemberWithDetails,
} from "@portalai/core/contracts";
import type { EntityGroup } from "@portalai/core/models";
import { Box, Icon, IconName, MetadataList, PageGrid, PageGridItem, PageHeader, PageSection, Stack, Typography } from "@portalai/core/ui";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import CircularProgress from "@mui/material/CircularProgress";
import DeleteIcon from "@mui/icons-material/Delete";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import StarIcon from "@mui/icons-material/Star";

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";
import type { ServerError } from "../utils/api.util";
import DataResult from "../components/DataResult.component";
import { DeleteEntityRecordDialog } from "../components/DeleteEntityRecordDialog.component";
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
  isWriteEnabled?: boolean;
  onDelete?: () => void;
  isDeleting?: boolean;
  deleteServerError?: ServerError | null;
  deleteDialogOpen?: boolean;
  onOpenDeleteDialog?: () => void;
  onCloseDeleteDialog?: () => void;
}

export const EntityRecordDetailViewUI: React.FC<EntityRecordDetailViewUIProps> = ({
  entity,
  record,
  columns,
  groups = [],
  isWriteEnabled,
  onDelete,
  isDeleting,
  deleteServerError,
  deleteDialogOpen,
  onOpenDeleteDialog,
  onCloseDeleteDialog,
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
          secondaryActions={
            isWriteEnabled
              ? [{ label: "Delete", icon: <DeleteIcon />, onClick: () => onOpenDeleteDialog?.(), color: "error", disabled: isDeleting }]
              : undefined
          }
        />
        <PageGrid columns={{ xs: 1, md: 2 }}>
          {/* Metadata */}
          <PageGridItem>
            <PageSection title="Metadata" variant="outlined">
              <EntityRecordMetadata record={record} />
              {groups.length > 0 && (
                <MetadataList
                  data-testid="entity-groups-metadata"
                  items={[
                    {
                      label: "Entity Groups",
                      value: (
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
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
                      ),
                    },
                  ]}
                />
              )}
            </PageSection>
          </PageGridItem>

          {/* Fields */}
          <PageGridItem span={{ xs: 1, md: 2 }}>
            <PageSection title="Fields" variant="outlined">
              <MetadataList
                spacing={2}
                items={columns.map((col) => ({
                  label: col.label,
                  value: (
                    <EntityRecordFieldValue
                      value={record.normalizedData[col.key]}
                      type={col.type}
                    />
                  ),
                }))}
              />
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

        {deleteDialogOpen !== undefined && onCloseDeleteDialog && onDelete && (
          <DeleteEntityRecordDialog
            open={!!deleteDialogOpen}
            onClose={onCloseDeleteDialog}
            recordSourceId={record.sourceId}
            onConfirm={onDelete}
            isPending={isDeleting}
            serverError={deleteServerError ?? null}
          />
        )}
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
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const entityResult = sdk.connectorEntities.get(entityId);
  const recordResult = sdk.entityRecords.get(entityId, recordId);
  const groupsResult = sdk.entityGroups.listByEntity(entityId);
  const deleteMutation = sdk.entityRecords.delete(entityId, recordId);

  // Resolve write capability
  const connectorInstanceId = entityResult.data?.connectorEntity?.connectorInstanceId ?? "";
  const instanceResult = sdk.connectorInstances.get(connectorInstanceId, {
    enabled: !!connectorInstanceId,
  });
  const connectorDefinitionId = instanceResult.data?.connectorInstance?.connectorDefinitionId ?? "";
  const definitionResult = sdk.connectorDefinitions.get(connectorDefinitionId, {
    enabled: !!connectorDefinitionId,
  });

  const instance = instanceResult.data?.connectorInstance;
  const definition = definitionResult.data?.connectorDefinition;
  const isWriteEnabled = !!(
    definition?.capabilityFlags?.write &&
    (instance?.enabledCapabilityFlags?.write ?? true)
  );

  const handleDelete = useCallback(() => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        setDeleteDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.entityRecords.root });
        navigate({ to: `/entities/${entityId}` });
      },
    });
  }, [deleteMutation, queryClient, navigate, entityId]);

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
          isWriteEnabled={isWriteEnabled}
          onDelete={handleDelete}
          isDeleting={deleteMutation.isPending}
          deleteServerError={toServerError(deleteMutation.error)}
          deleteDialogOpen={deleteDialogOpen}
          onOpenDeleteDialog={() => setDeleteDialogOpen(true)}
          onCloseDeleteDialog={() => setDeleteDialogOpen(false)}
        />
      )}
    </DataResult>
  );
};
