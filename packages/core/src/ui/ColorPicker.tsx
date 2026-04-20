import React, { useRef, useEffect, useCallback, useState } from "react";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import MuiTooltip from "@mui/material/Tooltip";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import MuiIconButton from "@mui/material/IconButton";
import ColorizeIcon from "@mui/icons-material/Colorize";

export interface ColorSample {
  color: string;
  label?: string;
}

export const DEFAULT_COLOR_SAMPLES: ColorSample[] = [
  { color: "#ef4444", label: "Red" },
  { color: "#f97316", label: "Orange" },
  { color: "#eab308", label: "Yellow" },
  { color: "#22c55e", label: "Green" },
  { color: "#3b82f6", label: "Blue" },
  { color: "#8b5cf6", label: "Purple" },
  { color: "#ec4899", label: "Pink" },
  { color: "#64748b", label: "Slate" },
];

export interface ColorPickerProps {
  /** Current hex color value (e.g. "#ff0000") */
  value?: string;
  /** Called when the color changes */
  onChange?: (color: string) => void;
  /** Predefined color samples to display for quick selection */
  samples?: ColorSample[];
  /** Size of the color wheel in pixels */
  wheelSize?: number;
  /** Label displayed above the picker */
  label?: string;
  /** Whether the picker is disabled */
  disabled?: boolean;
}

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

function isValidHex(value: string): boolean {
  return HEX_REGEX.test(value);
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return [0, 0, l];

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;

  return [h, s, l];
}

function drawColorWheel(
  ctx: CanvasRenderingContext2D,
  size: number,
  lightness: number
) {
  const center = size / 2;
  const radius = center - 2;
  const imageData = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 180;
        const saturation = dist / radius;
        const hex = hslToHex(angle, saturation, lightness);

        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);

        const idx = (y * size + x) * 4;
        imageData.data[idx] = r;
        imageData.data[idx + 1] = g;
        imageData.data[idx + 2] = b;
        imageData.data[idx + 3] = 255;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

function drawIndicator(
  ctx: CanvasRenderingContext2D,
  size: number,
  hex: string
) {
  const [h, s] = hexToHsl(hex);
  const center = size / 2;
  const radius = center - 2;
  const angle = ((h - 180) * Math.PI) / 180;
  const dist = s * radius;
  const x = center + dist * Math.cos(angle);
  const y = center + dist * Math.sin(angle);

  ctx.beginPath();
  ctx.arc(x, y, 6, 0, 2 * Math.PI);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, 2 * Math.PI);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1;
  ctx.stroke();
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
  value = "#000000",
  onChange,
  samples,
  wheelSize = 200,
  label,
  disabled = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [prevValue, setPrevValue] = useState(value);
  const [inputValue, setInputValue] = useState(value);
  const [lightness, setLightness] = useState(() => {
    const [, , l] = hexToHsl(value);
    return l;
  });
  const isDragging = useRef(false);

  if (prevValue !== value) {
    setPrevValue(value);
    setInputValue(value);
    const [, , l] = hexToHsl(value);
    setLightness(l);
  }

  const redraw = useCallback(
    (
      canvas: HTMLCanvasElement,
      currentValue: string,
      currentLightness: number
    ) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, wheelSize, wheelSize);
      drawColorWheel(ctx, wheelSize, currentLightness);
      if (isValidHex(currentValue)) {
        drawIndicator(ctx, wheelSize, currentValue);
      }
    },
    [wheelSize]
  );

  const canvasCallbackRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      if (node) {
        redraw(node, value, lightness);
      }
    },
    [redraw, value, lightness]
  );

  useEffect(() => {
    if (open && canvasRef.current) {
      redraw(canvasRef.current, value, lightness);
    }
  }, [value, lightness, redraw, open]);

  const toggleOpen = useCallback(() => {
    if (disabled) return;
    setOpen((prev) => !prev);
  }, [disabled]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const pickColorFromCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas || disabled) return;

      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const center = wheelSize / 2;
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = center - 2;

      if (dist > radius) return;

      const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 180;
      const saturation = dist / radius;
      const hex = hslToHex(angle, saturation, lightness);

      setInputValue(hex);
      onChange?.(hex);
    },
    [wheelSize, lightness, onChange, disabled]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      isDragging.current = true;
      pickColorFromCanvas(e.clientX, e.clientY);
    },
    [pickColorFromCanvas, disabled]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDragging.current || disabled) return;
      pickColorFromCanvas(e.clientX, e.clientY);
    },
    [pickColorFromCanvas, disabled]
  );

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const newValue = raw.startsWith("#") ? raw : `#${raw}`;
      setInputValue(newValue);

      if (isValidHex(newValue)) {
        const [, , l] = hexToHsl(newValue);
        setLightness(l);
        onChange?.(newValue);
      }
    },
    [onChange]
  );

  const handleLightnessChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const newLightness = parseFloat(e.target.value);
      setLightness(newLightness);

      if (isValidHex(inputValue)) {
        const [h, s] = hexToHsl(inputValue);
        const newHex = hslToHex(h, s, newLightness);
        setInputValue(newHex);
        onChange?.(newHex);
      }
    },
    [inputValue, onChange, disabled]
  );

  const handleSampleClick = useCallback(
    (color: string) => {
      if (disabled) return;
      setInputValue(color);
      const [, , l] = hexToHsl(color);
      setLightness(l);
      onChange?.(color);
    },
    [onChange, disabled]
  );

  return (
    <Stack spacing={1.5} sx={{ opacity: disabled ? 0.5 : 1 }}>
      {label && (
        <Typography variant="subtitle2" color="text.secondary">
          {label}
        </Typography>
      )}

      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          value={inputValue}
          onChange={handleInputChange}
          disabled={disabled}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Box
                    data-testid="color-preview"
                    sx={{
                      width: 20,
                      height: 20,
                      borderRadius: "4px",
                      border: "1px solid",
                      borderColor: "divider",
                      backgroundColor: isValidHex(inputValue)
                        ? inputValue
                        : "#000000",
                    }}
                  />
                </InputAdornment>
              ),
            },
            htmlInput: {
              "aria-label": "Hex color value",
              maxLength: 7,
            },
          }}
          error={inputValue.length > 1 && !isValidHex(inputValue)}
          sx={{ width: 160 }}
        />
        <MuiIconButton
          ref={setAnchorEl}
          onClick={toggleOpen}
          disabled={disabled}
          aria-label="Toggle color picker"
          size="small"
          sx={{
            border: "1px solid",
            borderColor: open ? "primary.main" : "divider",
            borderRadius: 1,
          }}
        >
          <ColorizeIcon fontSize="small" />
        </MuiIconButton>
      </Stack>

      <Popper
        open={open}
        anchorEl={anchorEl}
        placement="bottom-start"
        data-testid="color-picker-popup"
        sx={{ zIndex: 1300 }}
      >
        <ClickAwayListener onClickAway={handleClose}>
          <Paper elevation={4} sx={{ p: 2, mt: 1 }}>
            <Stack spacing={1.5}>
              <Box
                sx={{
                  position: "relative",
                  width: wheelSize,
                  height: wheelSize,
                }}
              >
                <canvas
                  ref={canvasCallbackRef}
                  width={wheelSize}
                  height={wheelSize}
                  data-testid="color-wheel"
                  style={{
                    cursor: disabled ? "default" : "crosshair",
                    borderRadius: "50%",
                  }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                />
              </Box>

              <Box sx={{ width: wheelSize }}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={lightness}
                  onChange={handleLightnessChange}
                  disabled={disabled}
                  aria-label="Lightness"
                  style={{ width: "100%" }}
                  data-testid="lightness-slider"
                />
              </Box>
            </Stack>
          </Paper>
        </ClickAwayListener>
      </Popper>

      {samples && samples.length > 0 && (
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary">
            Samples
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={0.75}>
            {samples.map((sample) => (
              <MuiTooltip
                key={sample.color}
                title={sample.label ?? sample.color}
              >
                <Box
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  aria-label={`Select color ${sample.label ?? sample.color}`}
                  onClick={() => handleSampleClick(sample.color)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSampleClick(sample.color);
                    }
                  }}
                  sx={{
                    width: 28,
                    height: 28,
                    borderRadius: "4px",
                    backgroundColor: sample.color,
                    border: "2px solid",
                    borderColor:
                      value === sample.color ? "primary.main" : "divider",
                    cursor: disabled ? "default" : "pointer",
                    transition: "border-color 0.15s",
                    "&:hover": disabled ? {} : { borderColor: "primary.light" },
                    "&:focus-visible": {
                      outline: "2px solid",
                      outlineColor: "primary.main",
                      outlineOffset: 1,
                    },
                  }}
                />
              </MuiTooltip>
            ))}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
};

export default ColorPicker;
