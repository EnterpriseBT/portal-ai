import { describe, it, expect } from "@jest/globals";

import { AnalyticsService } from "../../services/analytics.service.js";
import {
  technicalIndicatorStream,
  type IndicatorName,
} from "../../services/technical-indicator-stream.js";

// A deterministic OHLCV series long enough to warm up every indicator
// (Ichimoku needs spanPeriod + displacement ≈ 78 rows).
const N = 120;
const RECORDS = Array.from({ length: N }, (_, i) => {
  const close = 100 + 10 * Math.sin(i / 5) + i * 0.3;
  return {
    _record_id: `r-${String(i).padStart(4, "0")}`,
    date: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString(),
    value: close,
    high: close + 2,
    low: close - 2,
    volume: 1000 + i,
  };
});

async function* asStream(records: Record<string, unknown>[], batchSize: number) {
  for (let i = 0; i < records.length; i += batchSize) {
    yield records.slice(i, i + batchSize);
  }
}

async function collect(
  records: Record<string, unknown>[],
  indicator: IndicatorName,
  batchSize = 7,
  params: Record<string, unknown> = {}
) {
  const rows: Record<string, unknown>[] = [];
  for await (const batch of technicalIndicatorStream(
    asStream(records, batchSize),
    { dateColumn: "date", valueColumn: "value", indicator, params },
    { batchSize: 13 }
  )) {
    rows.push(...batch);
  }
  return rows;
}

// Map an array-path value + a streamed row to a comparable numeric tuple.
// (The handle output uses its own lower-cased column names; we compare the
//  numeric content, in a fixed field order, not the key spelling.)
const EXTRACTORS: Record<
  IndicatorName,
  { arr: (v: any) => number[]; row: (r: any) => number[] }
> = {
  SMA: { arr: (v) => [v], row: (r) => [r.value] },
  EMA: { arr: (v) => [v], row: (r) => [r.value] },
  RSI: { arr: (v) => [v], row: (r) => [r.value] },
  ROC: { arr: (v) => [v], row: (r) => [r.value] },
  ATR: { arr: (v) => [v], row: (r) => [r.value] },
  OBV: { arr: (v) => [v], row: (r) => [r.value] },
  VWAP: { arr: (v) => [v], row: (r) => [r.value] },
  WilliamsR: { arr: (v) => [v], row: (r) => [r.value] },
  CCI: { arr: (v) => [v], row: (r) => [r.value] },
  PSAR: { arr: (v) => [v], row: (r) => [r.value] },
  MACD: {
    arr: (v) => [v.MACD ?? NaN, v.signal ?? NaN, v.histogram ?? NaN],
    row: (r) => [r.macd ?? NaN, r.signal ?? NaN, r.histogram ?? NaN],
  },
  BB: {
    arr: (v) => [v.upper, v.middle, v.lower, v.pb],
    row: (r) => [r.upper, r.middle, r.lower, r.pb],
  },
  Stochastic: {
    arr: (v) => [v.k ?? NaN, v.d ?? NaN],
    row: (r) => [r.k ?? NaN, r.d ?? NaN],
  },
  ADX: {
    arr: (v) => [v.adx, v.pdi, v.mdi],
    row: (r) => [r.adx, r.pdi, r.mdi],
  },
  Ichimoku: {
    arr: (v) => [v.conversion, v.base, v.spanA, v.spanB],
    row: (r) => [r.conversion, r.base, r.spanA, r.spanB],
  },
  Donchian: {
    arr: (v) => [v.upper, v.middle, v.lower],
    row: (r) => [r.upper, r.middle, r.lower],
  },
};

const PARAMS: Partial<Record<IndicatorName, Record<string, unknown>>> = {
  CCI: { period: 20 },
  ROC: { period: 12 },
  Donchian: { period: 20 },
};

const closeEq = (a: number, b: number) => {
  if (Number.isNaN(a) && Number.isNaN(b)) return;
  expect(a).toBeCloseTo(b, 6);
};

describe("technicalIndicatorStream — equals the array path row-for-row", () => {
  const indicators = Object.keys(EXTRACTORS) as IndicatorName[];

  it.each(indicators)("%s matches AnalyticsService.technicalIndicator", async (indicator) => {
    const params = PARAMS[indicator] ?? {};
    const whole = AnalyticsService.technicalIndicator({
      records: RECORDS,
      dateColumn: "date",
      valueColumn: "value",
      indicator,
      params,
    });
    const streamed = await collect(RECORDS, indicator, 7, params);

    // Same number of emitted rows, right-edge date alignment preserved.
    expect(streamed).toHaveLength(whole.values.length);
    expect(streamed.map((r) => r.date)).toEqual(whole.dates);

    const ex = EXTRACTORS[indicator];
    whole.values.forEach((v, i) => {
      const a = ex.arr(v as any);
      const b = ex.row(streamed[i] as any);
      expect(b).toHaveLength(a.length);
      a.forEach((av, j) => closeEq(b[j], av));
    });
  });

  it("carries the source _record_id tiebreaker onto output rows", async () => {
    const streamed = await collect(RECORDS, "SMA");
    expect(typeof streamed[0]._record_id).toBe("string");
  });

  it("is invariant to source batch size", async () => {
    const a = await collect(RECORDS, "MACD", 1);
    const b = await collect(RECORDS, "MACD", 50);
    expect(a).toEqual(b);
  });
});
