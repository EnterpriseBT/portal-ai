/**
 * Pure UI sub-form rendered inside `ApiEndpointForm` that shows the
 * pagination strategy dropdown + a per-strategy sub-form below it.
 * Phase 3 surfaces all four strategies in the UI for the first time.
 *
 * Each strategy's sub-form maps to the matching `PaginationConfig`
 * arm; the workflow container converts the flat `PaginationDraft`
 * back into the structured shape on save.
 */

import React from "react";

import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { Stack, Typography } from "@portalai/core/ui";

import type { FormErrors } from "../../utils/form-validation.util";
import type { PaginationDraft } from "./utils/rest-api-validation.util";

export interface PaginationFieldsUIProps {
  draft: PaginationDraft;
  onChange: <K extends keyof PaginationDraft>(
    field: K,
    value: PaginationDraft[K]
  ) => void;
  onBlur: (field: keyof PaginationDraft) => void;
  errors: FormErrors;
  touched: Record<string, boolean>;
}

export const PaginationFieldsUI: React.FC<PaginationFieldsUIProps> = ({
  draft,
  onChange,
  onBlur,
  errors,
  touched,
}) => {
  const textField = (
    name: keyof PaginationDraft,
    label: string,
    placeholder?: string,
    type: "text" | "number" = "text"
  ) => (
    <TextField
      label={label}
      placeholder={placeholder}
      type={type}
      value={draft[name] as string | number}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        onChange(
          name,
          (type === "number"
            ? Number(e.target.value)
            : e.target.value) as PaginationDraft[typeof name]
        )
      }
      onBlur={() => onBlur(name)}
      fullWidth
      error={touched[name as string] && !!errors[name as string]}
      helperText={touched[name as string] && errors[name as string]}
      slotProps={{
        htmlInput: {
          "aria-invalid":
            touched[name as string] && !!errors[name as string],
        },
      }}
    />
  );

  return (
    <Stack spacing={2}>
      <TextField
        select
        label="Pagination strategy"
        value={draft.strategy}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange("strategy", e.target.value as PaginationDraft["strategy"])
        }
        fullWidth
      >
        <MenuItem value="none">None (single page)</MenuItem>
        <MenuItem value="pageOffset">Page / offset</MenuItem>
        <MenuItem value="cursor">Cursor</MenuItem>
        <MenuItem value="linkHeader">Link header (RFC 5988)</MenuItem>
        <MenuItem value="linkBody">Next link in response body</MenuItem>
      </TextField>

      {draft.strategy === "pageOffset" ? (
        <Stack spacing={2}>
          <TextField
            select
            label="Style"
            value={draft.style}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onChange("style", e.target.value as PaginationDraft["style"])
            }
            fullWidth
          >
            <MenuItem value="page">Page number (1, 2, 3, …)</MenuItem>
            <MenuItem value="offset">Offset (0, 50, 100, …)</MenuItem>
          </TextField>
          {textField(
            "param",
            draft.style === "offset"
              ? "Offset parameter name"
              : "Page parameter name",
            draft.style === "offset" ? "resultOffset" : "page"
          )}
          {textField(
            "pageSize",
            "Page size",
            draft.style === "offset" ? "1000" : "1",
            "number"
          )}
          {textField(
            "pageSizeParam",
            draft.style === "offset"
              ? "Page-size parameter name"
              : "Page-size parameter name (optional)",
            draft.style === "offset" ? "resultRecordCount" : "per_page"
          )}
          {textField(
            "startPage",
            "Start page",
            draft.style === "offset" ? "0" : "1",
            "number"
          )}
          <FormControlLabel
            control={
              <Checkbox
                checked={draft.stopOnShortPage}
                onChange={(e) => onChange("stopOnShortPage", e.target.checked)}
              />
            }
            label="Stop when a page returns fewer records than the page size"
          />
        </Stack>
      ) : null}

      {draft.strategy === "cursor" ? (
        <Stack spacing={2}>
          {textField("cursorParam", "Cursor parameter name", "cursor")}
          <TextField
            select
            label="Cursor placement"
            value={draft.cursorPlacement}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onChange(
                "cursorPlacement",
                e.target.value as PaginationDraft["cursorPlacement"]
              )
            }
            fullWidth
          >
            <MenuItem value="query">Query parameter</MenuItem>
            <MenuItem value="header">Header</MenuItem>
            <MenuItem value="body">Body (template via {"{{cursor}}"})</MenuItem>
          </TextField>
          {textField(
            "cursorResponsePath",
            "Cursor response path",
            "meta.next"
          )}
        </Stack>
      ) : null}

      {draft.strategy === "linkHeader" ? (
        <Typography variant="caption" color="text.secondary">
          Follows the response&apos;s <code>Link</code> header with{" "}
          <code>rel=&quot;next&quot;</code> (RFC 5988). No further configuration
          needed.
        </Typography>
      ) : null}

      {draft.strategy === "linkBody" ? (
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">
            Reads the next page&apos;s URL from a dotted path in the response
            body and follows it verbatim. Use when the upstream API returns
            the next link in the body (e.g. NASA NEO&apos;s{" "}
            <code>links.next</code>).
          </Typography>
          {textField(
            "nextUrlPath",
            "Next-URL response path",
            "links.next"
          )}
        </Stack>
      ) : null}
    </Stack>
  );
};
