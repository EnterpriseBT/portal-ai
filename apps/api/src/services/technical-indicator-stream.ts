/**
 * Streaming technical_indicator fold (#159).
 *
 * The per-row indicator MAP, expressed as a single ordered pass over the
 * source so it scales to an unbounded handle (the transform-handle path).
 * Each indicator is driven through the `technicalindicators` library's
 * incremental `.nextValue()` API — the SAME library the array path
 * (`AnalyticsService.technicalIndicator`) uses, so the streamed output is
 * row-for-row equal to the array path (verified by cross-check tests).
 * Donchian has no library class; it folds over an online ring buffer, the
 * online twin of the array path's windowed slice.
 *
 * Emit rule: call `.nextValue(tick)` per input row; emit one output row when
 * the result's PRIMARY field is defined (the same warmup boundary
 * `.calculate()` uses — e.g. Stochastic emits once `%K` is ready, with `%D`
 * filling in a few rows later). Output rows carry the date (right-edge
 * aligned, like the array path) and, when present on the source row, a
 * `_record_id`/`id` tiebreaker so the resulting handle is itself
 * keyset-streamable.
 */

import {
  SMA,
  EMA,
  RSI,
  MACD,
  BollingerBands,
  ATR,
  OBV,
  Stochastic,
  ADX,
  VWAP,
  WilliamsR,
  CCI,
  ROC,
  PSAR,
  IchimokuCloud,
} from "technicalindicators";

export type IndicatorName =
  | "SMA"
  | "EMA"
  | "RSI"
  | "MACD"
  | "BB"
  | "ATR"
  | "OBV"
  | "Stochastic"
  | "ADX"
  | "VWAP"
  | "WilliamsR"
  | "CCI"
  | "ROC"
  | "PSAR"
  | "Ichimoku"
  | "Donchian";

export interface TechnicalIndicatorStreamParams {
  dateColumn: string;
  valueColumn: string;
  indicator: IndicatorName;
  params?: Record<string, unknown>;
}

type Candle = { high: number; low: number; close: number; volume?: number };

/**
 * A streaming driver for one indicator: instantiate the stateful computer,
 * map an input row to the library's per-tick input, and map a `.nextValue`
 * result to the emitted row's value columns (or `null` to skip — warmup).
 */
interface IndicatorDriver {
  /** Source columns each input row must supply (besides the date). */
  reads: "close" | "hlc" | "hlcv" | "hl";
  /** Push one tick; return the value columns to emit, or null during warmup. */
  next(row: {
    close: number;
    high: number;
    low: number;
    volume: number;
  }): Record<string, number> | null;
}

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" ? v : fallback;

/** Build the per-indicator streaming driver from the tool params. */
function makeDriver(
  indicator: IndicatorName,
  p: Record<string, unknown>
): IndicatorDriver {
  const period = num(p.period, 14);

  switch (indicator) {
    case "SMA": {
      const sma = new SMA({ period, values: [] });
      return {
        reads: "close",
        next: ({ close }) => {
          const v = sma.nextValue(close);
          return v == null ? null : { value: v };
        },
      };
    }
    case "EMA": {
      const ema = new EMA({ period, values: [] });
      return {
        reads: "close",
        next: ({ close }) => {
          const v = ema.nextValue(close);
          return v == null ? null : { value: v };
        },
      };
    }
    case "RSI": {
      const rsi = new RSI({ period, values: [] });
      return {
        reads: "close",
        next: ({ close }) => {
          const v = rsi.nextValue(close);
          return v == null ? null : { value: v };
        },
      };
    }
    case "ROC": {
      const roc = new ROC({ period: num(p.period, 12), values: [] });
      return {
        reads: "close",
        next: ({ close }) => {
          const v = roc.nextValue(close);
          return v == null ? null : { value: v };
        },
      };
    }
    case "MACD": {
      const macd = new MACD({
        values: [],
        fastPeriod: num(p.fastPeriod, 12),
        slowPeriod: num(p.slowPeriod, 26),
        signalPeriod: num(p.signalPeriod, 9),
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      });
      return {
        reads: "close",
        next: ({ close }) => {
          const v = macd.nextValue(close);
          if (v == null || v.MACD == null) return null;
          const out: Record<string, number> = { macd: v.MACD };
          if (v.signal != null) out.signal = v.signal;
          if (v.histogram != null) out.histogram = v.histogram;
          return out;
        },
      };
    }
    case "BB": {
      const bb = new BollingerBands({
        period,
        values: [],
        stdDev: num(p.stdDev, 2),
      });
      return {
        reads: "close",
        next: ({ close }) => {
          const v = bb.nextValue(close);
          if (v == null) return null;
          return { upper: v.upper, middle: v.middle, lower: v.lower, pb: v.pb };
        },
      };
    }
    case "ATR": {
      const atr = new ATR({ period, high: [], low: [], close: [] });
      return {
        reads: "hlc",
        next: ({ high, low, close }) => {
          const v = atr.nextValue({ high, low, close });
          return v == null ? null : { value: v };
        },
      };
    }
    case "OBV": {
      const obv = new OBV({ close: [], volume: [] });
      return {
        reads: "hlcv",
        next: ({ close, volume }) => {
          const v = obv.nextValue({ close, volume } as Candle);
          return v == null ? null : { value: v };
        },
      };
    }
    case "VWAP": {
      const vwap = new VWAP({ high: [], low: [], close: [], volume: [] });
      return {
        reads: "hlcv",
        next: ({ high, low, close, volume }) => {
          const v = vwap.nextValue({ high, low, close, volume });
          return v == null ? null : { value: v };
        },
      };
    }
    case "WilliamsR": {
      const wr = new WilliamsR({ period, high: [], low: [], close: [] });
      return {
        reads: "hlc",
        next: ({ high, low, close }) => {
          const v = wr.nextValue({ high, low, close } as never);
          return v == null ? null : { value: v };
        },
      };
    }
    case "CCI": {
      const cci = new CCI({ period: num(p.period, 20), high: [], low: [], close: [] });
      return {
        reads: "hlc",
        next: ({ high, low, close }) => {
          const v = cci.nextValue({ high, low, close });
          return v == null ? null : { value: v };
        },
      };
    }
    case "Stochastic": {
      const stoch = new Stochastic({
        period,
        signalPeriod: num(p.signalPeriod, 3),
        high: [],
        low: [],
        close: [],
      });
      return {
        reads: "hlc",
        next: ({ high, low, close }) => {
          const v = stoch.nextValue({ high, low, close } as never);
          // Emit once %K is ready; %D (signal) warms up a few rows later.
          if (v == null || v.k == null) return null;
          const out: Record<string, number> = { k: v.k };
          if (v.d != null) out.d = v.d;
          return out;
        },
      };
    }
    case "ADX": {
      const adx = new ADX({ period, high: [], low: [], close: [] });
      return {
        reads: "hlc",
        next: ({ high, low, close }) => {
          const v = adx.nextValue({ high, low, close } as never);
          if (v == null || v.adx == null) return null;
          return { adx: v.adx, pdi: v.pdi, mdi: v.mdi };
        },
      };
    }
    case "PSAR": {
      const psar = new PSAR({
        step: num(p.step, 0.02),
        max: num(p.max, 0.2),
        high: [],
        low: [],
      });
      return {
        reads: "hl",
        next: ({ high, low }) => {
          const v = psar.nextValue({ high, low } as never);
          return v == null ? null : { value: v };
        },
      };
    }
    case "Ichimoku": {
      const ich = new IchimokuCloud({
        conversionPeriod: num(p.conversionPeriod, 9),
        basePeriod: num(p.basePeriod, 26),
        spanPeriod: num(p.spanPeriod, 52),
        displacement: num(p.displacement, 26),
        high: [],
        low: [],
      });
      return {
        reads: "hl",
        next: ({ high, low }) => {
          const v = ich.nextValue({ high, low } as never);
          if (v == null || v.conversion == null) return null;
          return {
            conversion: v.conversion,
            base: v.base,
            spanA: v.spanA,
            spanB: v.spanB,
          };
        },
      };
    }
    case "Donchian": {
      // Online twin of the array path's windowed max/min: a ring buffer of
      // the last `period` highs/lows. Emits once the window is full.
      const dcPeriod = num(p.period, 20);
      const highs: number[] = [];
      const lows: number[] = [];
      return {
        reads: "hl",
        next: ({ high, low }) => {
          highs.push(high);
          lows.push(low);
          if (highs.length > dcPeriod) {
            highs.shift();
            lows.shift();
          }
          if (highs.length < dcPeriod) return null;
          const upper = Math.max(...highs);
          const lower = Math.min(...lows);
          return { upper, middle: (upper + lower) / 2, lower };
        },
      };
    }
    default:
      throw new Error(`Unsupported indicator: ${indicator}`);
  }
}

/** Column names a driver reads off each source row (besides the date). */
function sourceColumns(
  valueColumn: string,
  p: Record<string, unknown>
): { close: string; high: string; low: string; volume: string } {
  return {
    close: valueColumn,
    high: (p.highColumn as string) ?? "high",
    low: (p.lowColumn as string) ?? "low",
    volume: (p.volumeColumn as string) ?? "volume",
  };
}

/**
 * Fold a source stream (ordered by `dateColumn`) into indicator output rows.
 * Yields output-row batches; each row is
 * `{ [_record_id?], [dateColumn]: date, ...valueColumns }`, right-edge aligned
 * to the source dates exactly as the array path. Bounded memory: the driver
 * holds O(period) state, never the full series.
 */
export async function* technicalIndicatorStream(
  sourceBatches: AsyncIterable<Record<string, unknown>[]>,
  params: TechnicalIndicatorStreamParams,
  opts: { batchSize?: number } = {}
): AsyncGenerator<Record<string, unknown>[]> {
  const p = params.params ?? {};
  const driver = makeDriver(params.indicator, p);
  const cols = sourceColumns(params.valueColumn, p);
  const batchSize = opts.batchSize ?? 1_000;

  let out: Record<string, unknown>[] = [];
  for await (const batch of sourceBatches) {
    for (const rec of batch) {
      const tick = {
        close: Number(rec[cols.close]),
        high: Number(rec[cols.high]),
        low: Number(rec[cols.low]),
        volume: Number(rec[cols.volume]),
      };
      const components = driver.next(tick);
      if (components === null) continue;
      const row: Record<string, unknown> = {
        [params.dateColumn]: rec[params.dateColumn],
        ...components,
      };
      // Carry a tiebreaker through so the output handle is keyset-streamable.
      if (rec._record_id !== undefined) row._record_id = rec._record_id;
      else if (rec.id !== undefined) row.id = rec.id;
      out.push(row);
      if (out.length >= batchSize) {
        yield out;
        out = [];
      }
    }
  }
  if (out.length > 0) yield out;
}
