import React, { useMemo, useState } from "react";

import { z } from "zod";
import type { UpdateStationBody, Toolpack } from "@portalai/core/contracts";
import type { Station } from "@portalai/core/models";
import { BUILTIN_TOOLPACKS } from "@portalai/core/registries";
import {
  Button,
  Modal,
  MultiSearchableSelect,
  Stack,
  Typography,
} from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";

import { ConnectorInstancePicker } from "./ConnectorInstancePicker.component";
import { CuratedViewPicker } from "./CuratedViewPicker.component";
import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import {
  validateWithSchema,
  focusFirstInvalidField,
  type FormErrors,
} from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import { ToolPackIconUtil } from "../utils/tool-pack-icons.util";
import {
  ALL_BUILTIN_SLUGS,
  isBuiltinPackEntitled,
  UNENTITLED_PACK_REASON,
} from "../utils/tool-packs.util";
import { detectToolpackCollisions } from "../utils/toolpack-collisions.util";
import { sdk } from "../api/sdk";

const BUILTIN_TOOL_PACK_OPTIONS: SelectOption[] = BUILTIN_TOOLPACKS.map(
  (pack) => {
    const Icon = ToolPackIconUtil.getIcon(pack.slug);
    return {
      value: pack.slug,
      label: pack.name,
      icon: <Icon fontSize="small" />,
    };
  }
);

/**
 * Mark the built-in options the org's plan doesn't include (#284).
 * `MultiSearchableSelect` honors `disabled` + `disabledReason`, so the pack
 * stays listed and states why it can't be picked.
 */
function withEntitlements(
  options: SelectOption[],
  entitledSlugs: ReadonlySet<string>
): SelectOption[] {
  return options.map((option) =>
    isBuiltinPackEntitled(String(option.value), entitledSlugs)
      ? option
      : { ...option, disabled: true, disabledReason: UNENTITLED_PACK_REASON }
  );
}

interface FormState {
  name: string;
  toolPacks: string[];
  connectorInstanceIds: string[];
  curatedViewIds: string[];
}

const EditStationFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  toolPacks: z.array(z.string()).min(1, "At least one tool pack is required"),
});

function validateForm(form: FormState): FormErrors {
  const result = validateWithSchema(EditStationFormSchema, form);
  return result.success ? {} : result.errors;
}

interface StationInstance {
  connectorInstanceId: string;
  /** #674: false for a connector the viewer can't read. */
  canRead: boolean;
}

interface StationViewAttachment {
  curatedViewId: string;
  curatedView?: { label: string };
  /** #674: false for a view the viewer can't read. */
  canRead: boolean;
}

/**
 * #674: what changed in one attachment kind since the dialog opened, as the
 * add/remove changes the update API takes, or undefined when nothing did. The
 * dialog never sends its full set: that set goes stale while the dialog is
 * open, and saving it re-attached what another editor had just removed.
 */
function attachmentChanges(
  initial: string[],
  current: string[]
): { add?: string[]; remove?: string[] } | undefined {
  const before = new Set(initial);
  const after = new Set(current);
  const add = current.filter((id) => !before.has(id));
  const remove = initial.filter((id) => !after.has(id));
  if (add.length === 0 && remove.length === 0) return undefined;
  return {
    ...(add.length > 0 ? { add } : {}),
    ...(remove.length > 0 ? { remove } : {}),
  };
}

export interface EditStationDialogProps {
  open: boolean;
  onClose: () => void;
  station: Station & {
    instances?: StationInstance[];
    /** #674: from include=curatedView. */
    views?: StationViewAttachment[];
    enabledToolpacks?: string[];
  };
  onSubmit: (body: UpdateStationBody) => void;
  isPending: boolean;
  serverError: ServerError | null;
  /**
   * Built-in pack slugs the org's tier includes (#284). Packs outside the
   * set render visible but unselectable with the reason named. A pack the
   * station *already* carries stays selected and removable — disabling
   * governs adding, so a downgrade never makes a station un-editable.
   * Defaults to every built-in (fail open); the server 403 is the gate.
   */
  entitledBuiltinSlugs?: ReadonlySet<string>;
}

export const EditStationDialog: React.FC<EditStationDialogProps> = ({
  open,
  onClose,
  station,
  onSubmit,
  isPending,
  serverError,
  entitledBuiltinSlugs = ALL_BUILTIN_SLUGS,
}) => {
  // #674: the pickers hold only what the viewer can read. Attachments they
  // can't read aren't theirs to remove, and the dialog only ever sends what
  // changed among the readable ones (see attachmentChanges).
  const initialInstanceIds = (station.instances ?? [])
    .filter((i) => i.canRead)
    .map((i) => i.connectorInstanceId);
  const readableViews = (station.views ?? []).filter((v) => v.canRead);
  const initialViewIds = readableViews.map((v) => v.curatedViewId);
  // Seeded once: the dialog remounts per station, and a stable object keeps
  // the picker from re-searching on every render.
  const [viewLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      readableViews.map((v) => [
        v.curatedViewId,
        v.curatedView?.label ?? v.curatedViewId,
      ])
    )
  );
  const initialToolpacks = station.enabledToolpacks ?? [];
  const [form, setForm] = useState<FormState>({
    name: station.name,
    toolPacks: [...initialToolpacks],
    connectorInstanceIds: [...initialInstanceIds],
    curatedViewIds: [...initialViewIds],
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const nameRef = useDialogAutoFocus(open);

  // Load custom toolpacks so the picker can offer them alongside built-ins.
  const customsResult = sdk.toolpacks.list(
    { kind: "custom" },
    { enabled: open }
  );
  const CustomIcon = ToolPackIconUtil.getCustomIcon();
  const customOptions: SelectOption[] = (customsResult.data?.toolpacks ?? [])
    .filter((t): t is typeof t & { kind: "custom" } => t.kind === "custom")
    .map((p) => ({
      value: `org:${p.id}`,
      label: p.name,
      icon: <CustomIcon fontSize="small" />,
    }));
  const allOptions = useMemo(
    () => [
      ...withEntitlements(BUILTIN_TOOL_PACK_OPTIONS, entitledBuiltinSlugs),
      ...customOptions,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entitledBuiltinSlugs, customsResult.data]
  );

  const collisions = useMemo(
    () =>
      detectToolpackCollisions(
        form.toolPacks,
        (customsResult.data?.toolpacks ?? []) as Toolpack[]
      ),
    [form.toolPacks, customsResult.data]
  );

  const handleChange = (field: keyof FormState, value: string | string[]) => {
    const next = { ...form, [field]: value };
    setForm(next);
    if (touched[field]) {
      setErrors(validateForm(next));
    }
  };

  const handleBlur = (field: keyof FormState) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(validateForm(form));
  };

  const handleSubmit = () => {
    setTouched({ name: true, toolPacks: true });
    const formErrors = validateForm(form);
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }

    const body: UpdateStationBody = {};
    if (form.name.trim() !== station.name) {
      body.name = form.name.trim();
    }
    if (JSON.stringify(form.toolPacks) !== JSON.stringify(initialToolpacks)) {
      body.toolPacks = form.toolPacks;
    }
    const connectorChanges = attachmentChanges(
      initialInstanceIds,
      form.connectorInstanceIds
    );
    if (connectorChanges) body.connectorInstanceChanges = connectorChanges;
    const viewChanges = attachmentChanges(initialViewIds, form.curatedViewIds);
    if (viewChanges) body.curatedViewChanges = viewChanges;

    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

    onSubmit(body);
  };

  return (
    <Modal
      submitDisabled={isPending}
      open={open}
      onClose={onClose}
      title="Edit Station"
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          onSubmit: (e: React.FormEvent) => {
            e.preventDefault();
            handleSubmit();
          },
        } as object,
      }}
      actions={
        <Stack direction="row" spacing={1}>
          <Button
            type="button"
            variant="outlined"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="contained"
            onClick={handleSubmit}
            disabled={isPending}
          >
            {isPending ? "Saving..." : "Save"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <TextField
          inputRef={nameRef}
          label="Name"
          value={form.name}
          onChange={(e) => handleChange("name", e.target.value)}
          onBlur={() => handleBlur("name")}
          error={touched.name && !!errors.name}
          helperText={touched.name && errors.name}
          slotProps={{
            htmlInput: { "aria-invalid": touched.name && !!errors.name },
          }}
          required
          fullWidth
        />
        <MultiSearchableSelect
          options={allOptions}
          value={form.toolPacks}
          onChange={(values) => handleChange("toolPacks", values)}
          label="Tool Packs"
          placeholder="Select tool packs..."
          required
          error={touched.toolPacks && !!errors.toolPacks}
          helperText={touched.toolPacks ? errors.toolPacks : undefined}
        />
        {collisions.length > 0 && (
          <Alert severity="warning" data-testid="toolpack-collision-warning">
            <AlertTitle>Tool-name collisions on this station</AlertTitle>
            <Stack spacing={0.5}>
              {collisions.map((c) => (
                <Typography key={c.toolName} variant="body2">
                  <code>{c.toolName}</code> is provided by{" "}
                  <strong>{c.ownerLabels.join(", ")}</strong>.
                </Typography>
              ))}
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 0.5, display: "block" }}
            >
              Portal sessions will fail until this is resolved. Save will be
              allowed so you can keep iterating; remove one of the conflicting
              packs to clear the warning.
            </Typography>
          </Alert>
        )}
        <ConnectorInstancePicker
          selected={form.connectorInstanceIds}
          onChange={(ids) => handleChange("connectorInstanceIds", ids)}
        />
        <CuratedViewPicker
          selected={form.curatedViewIds}
          onChange={(ids) => handleChange("curatedViewIds", ids)}
          selectedLabels={viewLabels}
        />
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};
