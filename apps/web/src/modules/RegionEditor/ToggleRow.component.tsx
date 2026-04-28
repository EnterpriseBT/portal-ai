import { Stack, Button } from "@portalai/core/ui";

export interface ToggleRowUIProps<T extends string> {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}

export function ToggleRowUI<T extends string>({
  value,
  onChange,
  options,
}: ToggleRowUIProps<T>) {
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Button
            key={o.value}
            size="small"
            variant={active ? "contained" : "outlined"}
            onClick={() => onChange(o.value)}
            sx={{ flex: 1, textTransform: "none", minWidth: 0 }}
          >
            {o.label}
          </Button>
        );
      })}
    </Stack>
  );
}
