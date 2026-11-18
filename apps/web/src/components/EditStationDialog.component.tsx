import React, { useMemo, useState } from "react";

import { z } from "zod";
import { descriptionField, nameField } from "@portalai/core/contracts";
import type {
  AttachedToolpack,
  UpdateStationBody,
  Toolpack,
} from "@portalai/core/contracts";
import type { Station } from "@portalai/core/models";
import { BUILTIN_TOOLPACKS } from "@portalai/core/registries";
import {
  GatedButton,
  Modal,
  MultiSearchableSelect,
  pendingGate,
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
  someBuiltinUnentitled,
  isBuiltinPackEntitled,
  listPackNames,
  UNENTITLED_PACK_REASON,
} from "../utils/tool-packs.util";
import { detectToolpackCollisions } from "../utils/toolpack-collisions.util";
import { sdk } from "../api/sdk";
import { ToolPackUpgradeNoteUI } from "./ToolPackUpgradeNote.component";
import { blurUnlessDialogControl } from "../utils/dialog-blur.util";

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
  description: string;
  toolPacks: string[];
  connectorInstanceIds: string[];
  curatedViewIds: string[];
}

/** #801: an edited name is held to the name limit. An unchanged one isn't
 *  (it isn't sent), so a station saved before the limit stays editable. The
 *  description follows the same rule (#848). */
const editStationFormSchema = (
  nameChanged: boolean,
  descriptionChanged: boolean
) =>
  z.object({
    name: nameChanged
      ? nameField()
      : z.string().trim().min(1, "Name is required"),
    description: descriptionChanged ? descriptionField() : z.string(),
    toolPacks: z.array(z.string()).min(1, "At least one tool pack is required"),
  });

/**
 * The station as the dialog opened on it: what the form is seeded from and
 * what a save is compared against. Captured once. Read from the live prop
 * instead, a refetch while the dialog is open made an untouched field look
 * edited, and saving put back what another editor had just changed (#848 for
 * the text fields, #1043 for packs and attachments).
 */
interface OriginalStation {
  name: string;
  description: string;
  toolPacks: string[];
  /** #674: only the connectors and views the viewer can read. */
  connectorInstanceIds: string[];
  curatedViewIds: string[];
  /** Labels for the attached views' chips, by view id. */
  viewLabels: Record<string, string>;
}

/** Whether a text field was edited. Both sides are trimmed: what is sent is
 *  trimmed, and a stored value isn't always. */
function nameChanged(form: FormState, original: OriginalStation): boolean {
  return form.name.trim() !== original.name.trim();
}

function descriptionChanged(
  form: FormState,
  original: OriginalStation
): boolean {
  return form.description.trim() !== original.description.trim();
}

function validateForm(form: FormState, original: OriginalStation): FormErrors {
  const schema = editStationFormSchema(
    nameChanged(form, original),
    descriptionChanged(form, original)
  );
  // The limit applies to the text that will be sent, which is trimmed.
  const result = validateWithSchema(schema, {
    ...form,
    description: form.description.trim(),
  });
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
 * #1052: tool packs are saved the same way. Order doesn't matter, so a pack
 * removed and added back is no change.
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
    /** #1063: the packs' names, from the station read. */
    toolpacks?: AttachedToolpack[];
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
  /**
   * #1063: the plan includes custom (organization) tool packs. Without them
   * custom packs are offered the way an unentitled built-in is: listed,
   * unselectable with the reason named, and removable where attached.
   * Defaults to `true` (fail open); the server 403 is the gate.
   */
  customPacksEntitled?: boolean;
}

export const EditStationDialog: React.FC<EditStationDialogProps> = ({
  open,
  onClose,
  station,
  onSubmit,
  isPending,
  serverError,
  entitledBuiltinSlugs = ALL_BUILTIN_SLUGS,
  customPacksEntitled = true,
}) => {
  // The dialog is mounted only while open, so this is the station as the
  // dialog opened on it, and the only place the dialog reads `station`.
  const [original] = useState<OriginalStation>(() => {
    // #674: the pickers hold only what the viewer can read. Attachments they
    // can't read aren't theirs to remove, and the dialog only ever sends
    // what changed among the readable ones (see attachmentChanges).
    const readableViews = (station.views ?? []).filter((v) => v.canRead);
    return {
      name: station.name,
      // #848: a station with no description edits as an empty field, and
      // leaving it empty is not a change.
      description: station.description ?? "",
      toolPacks: station.enabledToolpacks ?? [],
      connectorInstanceIds: (station.instances ?? [])
        .filter((i) => i.canRead)
        .map((i) => i.connectorInstanceId),
      curatedViewIds: readableViews.map((v) => v.curatedViewId),
      // Held here so the object is stable: the view picker re-searches when
      // its labels change identity.
      viewLabels: Object.fromEntries(
        readableViews.map((v) => [
          v.curatedViewId,
          v.curatedView?.label ?? v.curatedViewId,
        ])
      ),
    };
  });
  const [form, setForm] = useState<FormState>(() => ({
    name: original.name,
    description: original.description,
    toolPacks: original.toolPacks,
    connectorInstanceIds: original.connectorInstanceIds,
    curatedViewIds: original.curatedViewIds,
  }));
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
      // #1063: the plan's custom packs, as `withEntitlements` does built-ins.
      ...(customPacksEntitled
        ? {}
        : { disabled: true, disabledReason: UNENTITLED_PACK_REASON }),
    }));
  const allOptions = useMemo(
    () => [
      ...withEntitlements(BUILTIN_TOOL_PACK_OPTIONS, entitledBuiltinSlugs),
      ...customOptions,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entitledBuiltinSlugs, customsResult.data, customPacksEntitled]
  );

  // #1052: the picker reports only values it has an option for, so a pack
  // with none (a custom pack while the list loads, or for good when the list
  // is refused, as it is for anyone who can't read tool packs) would vanish
  // from the form on the next change and be sent as removed. Such packs are
  // put back on every change and left out of what is sent: the editor
  // changes only packs they can see (#674's rule for attachments).
  const shownPacks = useMemo(
    () => new Set(allOptions.map((option) => String(option.value))),
    [allOptions]
  );
  const unshownPacks = form.toolPacks.filter((pack) => !shownPacks.has(pack));
  // Said in both states, so a station that looks empty in the picker never
  // looks empty without a reason. While loading, the list may still give
  // these packs their chips.
  // #1063: named from the station read when every such pack has a name.
  const unshownNames = unshownPacks.map(
    (pack) => station.toolpacks?.find((p) => p.ref === pack)?.name
  );
  const unshownPacksNote =
    unshownPacks.length === 0
      ? undefined
      : customsResult.isLoading
        ? "Loading custom tool packs…"
        : unshownNames.every((name) => name !== undefined)
          ? `${listPackNames(unshownNames as string[])} can't be changed here.`
          : unshownPacks.length === 1
            ? "1 tool pack on this station can't be changed here."
            : `${unshownPacks.length} tool packs on this station can't be changed here.`;

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
      setErrors(validateForm(next, original));
    }
  };

  const handleBlur = (field: keyof FormState) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(validateForm(form, original));
  };

  const handleSubmit = () => {
    setTouched({ name: true, description: true, toolPacks: true });
    const formErrors = validateForm(form, original);
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }

    const body: UpdateStationBody = {};
    if (nameChanged(form, original)) {
      body.name = form.name.trim();
    }
    // #848: sent only when edited. An emptied field clears the description.
    if (descriptionChanged(form, original)) {
      body.description = form.description.trim();
    }
    const shown = (packs: string[]) =>
      packs.filter((pack) => shownPacks.has(pack));
    const packChanges = attachmentChanges(
      shown(original.toolPacks),
      shown(form.toolPacks)
    );
    if (packChanges) body.toolPackChanges = packChanges;
    const connectorChanges = attachmentChanges(
      original.connectorInstanceIds,
      form.connectorInstanceIds
    );
    if (connectorChanges) body.connectorInstanceChanges = connectorChanges;
    const viewChanges = attachmentChanges(
      original.curatedViewIds,
      form.curatedViewIds
    );
    if (viewChanges) body.curatedViewChanges = viewChanges;

    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

    onSubmit(body);
  };

  return (
    <Modal
      pending={isPending}
      submitDisabled={isPending}
      open={open}
      onClose={onClose}
      title="Edit Station"
      maxWidth="sm"
      fullWidth
      onSubmit={handleSubmit}
      actions={
        <Stack direction="row" spacing={1}>
          <GatedButton
            type="button"
            variant="outlined"
            onClick={onClose}
            gate={pendingGate(isPending, "Wait for this to finish")}
          >
            Cancel
          </GatedButton>
          <GatedButton
            type="button"
            variant="contained"
            onClick={handleSubmit}
            gate={pendingGate(isPending)}
          >
            {isPending ? "Saving..." : "Save"}
          </GatedButton>
        </Stack>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <TextField
          inputRef={nameRef}
          label="Name"
          value={form.name}
          onChange={(e) => handleChange("name", e.target.value)}
          onBlur={blurUnlessDialogControl(() => handleBlur("name"))}
          error={touched.name && !!errors.name}
          helperText={touched.name && errors.name}
          slotProps={{
            htmlInput: { "aria-invalid": touched.name && !!errors.name },
          }}
          required
          fullWidth
        />
        <TextField
          label="Description"
          value={form.description}
          onChange={(e) => handleChange("description", e.target.value)}
          onBlur={blurUnlessDialogControl(() => handleBlur("description"))}
          error={touched.description && !!errors.description}
          helperText={touched.description && errors.description}
          slotProps={{
            htmlInput: {
              "aria-invalid": touched.description && !!errors.description,
            },
          }}
          fullWidth
          multiline
          rows={3}
        />
        <MultiSearchableSelect
          options={allOptions}
          value={form.toolPacks}
          onChange={(values) =>
            handleChange("toolPacks", [...values, ...unshownPacks])
          }
          label="Tool Packs"
          placeholder="Select tool packs..."
          required
          error={touched.toolPacks && !!errors.toolPacks}
          helperText={
            (touched.toolPacks ? errors.toolPacks : undefined) ??
            unshownPacksNote
          }
        />
        <ToolPackUpgradeNoteUI
          show={
            someBuiltinUnentitled(entitledBuiltinSlugs) ||
            // #1063: a custom pack is offered or attached, and the plan
            // excludes custom packs.
            (!customPacksEntitled &&
              (customOptions.length > 0 ||
                form.toolPacks.some((pack) => pack.startsWith("org:"))))
          }
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
          selectedLabels={original.viewLabels}
        />
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};
