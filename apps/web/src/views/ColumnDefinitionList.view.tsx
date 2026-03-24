import React from "react";

import type {
  ColumnDefinitionListRequestQuery,
  ColumnDefinitionListResponsePayload,
} from "@portalai/core/contracts";
import { ColumnDataTypeEnum } from "@portalai/core/models";
import { Box, Breadcrumbs, Stack, Typography } from "@portalai/core/ui";
import { IconName } from "@portalai/core/ui";

import { useNavigate } from "@tanstack/react-router";

import {
  ColumnDefinitionDataList,
  ColumnDefinitionCardUI,
} from "../components/ColumnDefinition.component";
import DataResult from "../components/DataResult.component";
import { SyncTotal } from "../components/SyncTotal.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";

const TYPE_OPTIONS = ColumnDataTypeEnum.options.map((t) => ({
  label: t,
  value: t,
}));

export const ColumnDefinitionListView: React.FC = () => {
  const navigate = useNavigate();

  const pagination = usePagination({
    sortFields: [
      { field: "key", label: "Key" },
      { field: "label", label: "Label" },
      { field: "type", label: "Type" },
      { field: "created", label: "Created" },
    ],
    defaultSortBy: "created",
    defaultSortOrder: "asc",
    filters: [
      {
        type: "multi-select",
        field: "type",
        label: "Type",
        options: TYPE_OPTIONS,
      },
      {
        type: "boolean",
        field: "required",
        label: "Required",
      },
    ],
  });

  return (
    <Box>
      <Stack spacing={4}>
        <Box>
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: "/", icon: IconName.Home },
              { label: "Column Definitions" },
            ]}
            onNavigate={(href) => navigate({ to: href })}
          />

          <Typography variant="h1">Column Definitions</Typography>
        </Box>

        <PaginationToolbar {...pagination.toolbarProps} />

        <Box>
          <ColumnDefinitionDataList
            query={pagination.queryParams as ColumnDefinitionListRequestQuery}
          >
            {(listResult) => (
              <SyncTotal
                total={listResult.data?.total}
                setTotal={pagination.setTotal}
              >
                <DataResult results={{ list: listResult }}>
                  {({
                    list,
                  }: {
                    list: ColumnDefinitionListResponsePayload;
                  }) => {
                    if (list.columnDefinitions.length === 0) {
                      return (
                        <Typography
                          variant="body1"
                          color="text.secondary"
                          sx={{ py: 4, textAlign: "center" }}
                        >
                          No column definitions found
                        </Typography>
                      );
                    }

                    return (
                      <Stack spacing={1}>
                        {list.columnDefinitions.map((cd) => (
                          <ColumnDefinitionCardUI
                            key={cd.id}
                            columnDefinition={cd}
                            onClick={() =>
                              navigate({
                                to: `/column-definitions/${cd.id}`,
                              })
                            }
                          />
                        ))}
                      </Stack>
                    );
                  }}
                </DataResult>
              </SyncTotal>
            )}
          </ColumnDefinitionDataList>
        </Box>
      </Stack>
    </Box>
  );
};
