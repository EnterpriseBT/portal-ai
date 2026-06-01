export function isValidIanaTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const PART_TYPES = [
  "year",
  "month",
  "day",
  "hour",
  "minute",
  "second",
] as const;

type PartType = (typeof PART_TYPES)[number];

function extractParts(date: Date, timeZone: string): Record<PartType, number> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const out = {} as Record<PartType, number>;
  for (const t of PART_TYPES) {
    const p = parts.find((x) => x.type === t);
    if (!p) throw new Error(`Missing ${t} part in formatToParts output`);
    // hour can be "24" in some locales when crossing midnight; normalize.
    const n = parseInt(p.value, 10);
    out[t] = t === "hour" && n === 24 ? 0 : n;
  }
  return out;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatIsoWithOffset(date: Date, tz: string): string {
  const p = extractParts(date, tz);
  const localAsUtcMs = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second
  );
  const offsetMinutes = Math.round((localAsUtcMs - date.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offsetH = Math.floor(abs / 60);
  const offsetM = abs % 60;
  return (
    `${p.year}-${pad2(p.month)}-${pad2(p.day)}T` +
    `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}` +
    `${sign}${pad2(offsetH)}:${pad2(offsetM)}`
  );
}
