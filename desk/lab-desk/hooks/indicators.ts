// Indicators the desk paints on the chart, computed the way TradingView's ta.* does
// (stated per function), from the candles the chart already holds. Pure: no `$`.
//
// A study is named the way people type it: "ema 50", "bb 20 2", "rsi", "macd 12 26 9".
// Values before an indicator has enough candles are null and never drawn.

import type { Candle } from '../types'
import type { Node } from './formula'
import { evalFormula, formulaLabel, formulaPane, formulaWarmup, parseFormula, printFormula } from './formula'

export type Kind =
  | 'sma'
  | 'ema'
  | 'hma'
  | 'bb'
  | 'keltner'
  | 'vwap'
  | 'donchian'
  | 'supertrend'
  | 'rsi'
  | 'stochrsi'
  | 'stoch'
  | 'macd'
  | 'adx'
  | 'atr'
  | 'obv'
  | 'plot'

/** What a person or Claude asks for: a kind and its numbers, in the order typed. */
export type Spec = {
  kind: Kind
  params: number[]
  /** A formula plot only: the formula as Pine, spaced the standard way. */
  expr?: string
}

/** A formula plot's parsed formula. */
function nodeOf(spec: Spec): Node | null {
  if (spec.kind !== 'plot' || !spec.expr) return null
  const n = parseFormula(spec.expr)
  return 'error' in n ? null : n
}

/** Where a study draws: a formula plot on the price chart when it is a price level, else its kind's pane. */
export function paneOf(spec: Spec): 'price' | 'lower' {
  const n = nodeOf(spec)
  return n ? formulaPane(n) : KINDS[spec.kind].pane
}

export type LineStyle = 'line' | 'dash' | 'hist' | 'dots'
export type Series = {
  name: string
  values: (number | null)[]
  style: LineStyle
  /** A lower-pane line in its own color: the candle colors (+DI, -DI) or the second ink, dashed (MACD avg, %D). */
  tone?: 'up' | 'down' | 'alt'
}

/** One indicator, ready to draw: on the price chart, or in a pane of its own under it. */
export type Study = {
  /** "ema 50": the spec as text, also its key. */
  id: string
  /** "EMA 50": what the legend says. */
  label: string
  kind: Kind
  pane: 'price' | 'lower'
  series: Series[]
  /** Fill between two series (by index), e.g. the Bollinger band. */
  fill?: [number, number]
  /** Lower pane only: a fixed scale and its guide lines (RSI 0..100 with 30/70). */
  scale?: { min: number; max: number; levels: number[] }
  /** Supertrend: which side the line is on per candle (1 below price, -1 above), for its two colors. */
  side?: (1 | -1 | null)[]
  /** Its own color (hex), outside the slot inks: the Compare line. */
  ink?: string
  /** Values read as % change from this one: the Compare line's legend. */
  pctOf?: number
}

/** The Compare line's ink: apart from the indicator inks and the candle colors. */
export const COMPARE_INK = '#29b6f6'

/**
 * TradingView's Compare: another coin's closes laid over the chart from the first candle at or after `from` (ms), scaled
 * so both start at the same point; the legend reads it as % change. Candles are matched by time; gaps stay empty. One
 * anchor time for every view, so the pane, the terminal and Claude's sentence give the same numbers.
 */
export function compareStudy(coin: string, base: readonly Candle[], other: readonly Candle[], from: number): Study | null {
  const byT = new Map(other.map(c => [c.t, c.c]))
  let k = base.findIndex(c => c.t >= from)
  if (k < 0) return null
  while (k < base.length && !byT.get((base[k] as Candle).t)) k++
  const anchor = base[k]
  const otherAt = anchor ? byT.get(anchor.t) : undefined
  if (!anchor || !otherAt) return null
  const values = base.map((c, i) => {
    const v = i < k ? undefined : byT.get(c.t)
    return v === undefined ? null : (anchor.c * v) / otherAt
  })
  return {
    id: `compare ${coin.toLowerCase()}`,
    label: coin,
    kind: 'sma',
    pane: 'price',
    series: [{ name: coin, values, style: 'line' }],
    ink: COMPARE_INK,
    pctOf: anchor.c,
  }
}

type Info = {
  name: string
  pane: 'price' | 'lower'
  defaults: number[]
  /** Smallest and largest of each number. */
  limits: [number, number][]
  what: string
}

export const KINDS: Readonly<Record<Kind, Info>> = {
  sma: { name: 'SMA', pane: 'price', defaults: [20], limits: [[1, 1000]], what: 'simple moving average of closes' },
  ema: { name: 'EMA', pane: 'price', defaults: [20], limits: [[1, 1000]], what: 'exponential moving average of closes' },
  hma: { name: 'HMA', pane: 'price', defaults: [9], limits: [[2, 500]], what: 'Hull moving average: smooth and quick to turn' },
  bb: { name: 'BB', pane: 'price', defaults: [20, 2], limits: [[2, 500], [0.1, 10]], what: 'Bollinger Bands: SMA with 2 standard deviations each side' },
  keltner: { name: 'KC', pane: 'price', defaults: [20, 2, 10], limits: [[1, 500], [0.1, 10], [1, 200]], what: 'Keltner Channels: EMA 20 with 2 ATR (10) each side' },
  vwap: { name: 'VWAP', pane: 'price', defaults: [], limits: [], what: 'volume-weighted average price, restarting each UTC day' },
  donchian: { name: 'Donchian', pane: 'price', defaults: [20], limits: [[1, 500]], what: 'highest high and lowest low of the last N candles' },
  supertrend: { name: 'Supertrend', pane: 'price', defaults: [10, 3], limits: [[1, 200], [0.1, 20]], what: 'ATR trailing line that flips sides with the trend' },
  rsi: { name: 'RSI', pane: 'lower', defaults: [14], limits: [[2, 200]], what: 'relative strength index, 0 to 100' },
  stochrsi: { name: 'Stoch RSI', pane: 'lower', defaults: [3, 3, 14, 14], limits: [[1, 50], [1, 50], [2, 200], [2, 200]], what: 'Stochastic of RSI, 0 to 100: %K and %D (K smoothing, D smoothing, RSI length, stoch length)' },
  stoch: { name: 'Stoch', pane: 'lower', defaults: [14, 1, 3], limits: [[1, 200], [1, 50], [1, 50]], what: 'Stochastic, 0 to 100: where the close sits in the last 14 candles, %K and %D' },
  macd: { name: 'MACD', pane: 'lower', defaults: [12, 26, 9], limits: [[1, 200], [2, 400], [1, 200]], what: 'gap between a fast and slow EMA, with its own average and histogram' },
  adx: { name: 'ADX', pane: 'lower', defaults: [14, 14], limits: [[1, 200], [1, 200]], what: 'trend strength 0 to 100 with +DI and -DI (ADX smoothing, DI length)' },
  atr: { name: 'ATR', pane: 'lower', defaults: [14], limits: [[1, 200]], what: 'average true range: how far price moves per candle' },
  obv: { name: 'OBV', pane: 'lower', defaults: [], limits: [], what: 'on-balance volume: volume added on up closes, taken off on down closes' },
  plot: { name: 'Plot', pane: 'lower', defaults: [], limits: [], what: 'your own formula in Pine: series close/open/high/low/volume/hl2, + - * /, ta.ema/sma/rma/wma/hma/rsi/atr/stdev/highest/lowest/change, math.abs/max/min' },
}

/** Ready-made sets, one word each. */
export const PRESETS: Readonly<Record<string, string[]>> = {
  trend: ['ema 20', 'ema 50', 'ema 200'],
  momentum: ['rsi 14', 'macd 12 26 9'],
  volatility: ['bb 20 2', 'atr 14'],
  breakout: ['donchian 20', 'vwap'],
  supertrend: ['supertrend 10 3'],
  strength: ['adx 14 14', 'stochrsi 3 3 14 14'],
}

/** At most this many studies at once: the legend and the lower panes stay readable. */
export const MAX_STUDIES = 6
/** At most this many lower panes; more oscillators than this are refused with a hint. */
export const MAX_LOWER = 2

const ALIASES: Record<string, Kind> = {
  ma: 'sma',
  sma: 'sma',
  ema: 'ema',
  hma: 'hma',
  hull: 'hma',
  bb: 'bb',
  kc: 'keltner',
  keltner: 'keltner',
  boll: 'bb',
  bollinger: 'bb',
  vwap: 'vwap',
  dc: 'donchian',
  donchian: 'donchian',
  st: 'supertrend',
  supertrend: 'supertrend',
  rsi: 'rsi',
  stochrsi: 'stochrsi',
  srsi: 'stochrsi',
  stoch: 'stoch',
  stochastic: 'stoch',
  macd: 'macd',
  adx: 'adx',
  dmi: 'adx',
  atr: 'atr',
  obv: 'obv',
  plot: 'plot',
}

/** "EMA(50)", "ema 50", "bb 20,2", "rsi" → a spec with the defaults filled in, or an error in plain words. */
export function parseSpec(text: string): Spec | { error: string } {
  // "plot ta.ema(close, 20) - ta.ema(close, 50)": a formula, read by its own parser.
  const formula = /^\s*plot\b\s*(.*)$/is.exec(text)
  if (formula) {
    const n = parseFormula(formula[1] ?? '')
    return 'error' in n ? n : { kind: 'plot', params: [], expr: printFormula(n) }
  }
  const words = text
    .toLowerCase()
    .replace(/[(),:]/g, ' ')
    // Two-word names: "stoch rsi", "stochastic rsi", "keltner channels", "bollinger bands", "hull ma".
    .replace(/\b(stoch|stochastic)\s+rsi\b/g, 'stochrsi')
    .replace(/\b(keltner|bollinger|donchian)\s+(channels?|bands?)\b/g, '$1')
    .replace(/\bhull\s+(ma|moving average)\b/g, 'hma')
    .trim()
    .split(/\s+/)
    .filter(w => w !== '')
  const head = words[0] ?? ''
  // "ema50" reads as "ema 50".
  const glued = /^([a-z]+)(\d+(?:\.\d+)?)$/.exec(head)
  const name = glued ? glued[1] ?? '' : head
  const rest = glued ? [glued[2] ?? '', ...words.slice(1)] : words.slice(1)
  const kind = ALIASES[name]
  if (!kind) return { error: `No indicator called "${head || text}". Try: ${Object.keys(KINDS).join(', ')}.` }
  const info = KINDS[kind]
  if (rest.length > info.defaults.length) return { error: `${info.name} takes ${info.defaults.length === 0 ? 'no numbers' : `up to ${info.defaults.length} number${info.defaults.length > 1 ? 's' : ''}`}, e.g. ${example(kind)}.` }
  const params = [...info.defaults]
  for (let i = 0; i < rest.length; i++) {
    const n = Number(rest[i])
    const [lo, hi] = info.limits[i] ?? [1, 1000]
    if (!Number.isFinite(n) || n < lo || n > hi) return { error: `${info.name}: ${rest[i]} is out of range (${lo} to ${hi}), e.g. ${example(kind)}.` }
    params[i] = i === 1 && (kind === 'bb' || kind === 'supertrend' || kind === 'keltner') ? n : Math.round(n)
  }
  if (kind === 'macd' && (params[0] ?? 0) >= (params[1] ?? 0)) return { error: 'MACD: the fast length must be shorter than the slow one, e.g. macd 12 26 9.' }
  return { kind, params }
}

export function example(kind: Kind): string {
  if (kind === 'plot') return 'plot ta.ema(close, 20) - ta.ema(close, 50)'
  return specId({ kind, params: [...KINDS[kind].defaults] })
}

/** The spec as text: "ema 50", "bb 20 2", "vwap". */
export function specId(spec: Spec): string {
  if (spec.kind === 'plot') return `plot ${spec.expr ?? ''}`
  return [spec.kind, ...spec.params.map(n => String(n))].join(' ')
}

/** "EMA 50", "BB 20 2", "VWAP". */
export function specLabel(spec: Spec): string {
  if (spec.kind === 'plot') {
    const n = nodeOf(spec)
    return n ? formulaLabel(n) : 'plot'
  }
  return [KINDS[spec.kind].name, ...spec.params.map(n => String(n))].join(' ')
}

/** How many candles before the first shown one an indicator wants, so its first drawn value is settled. */
export function warmup(spec: Spec): number {
  switch (spec.kind) {
    case 'sma':
    case 'bb':
    case 'donchian':
      return spec.params[0] ?? 20
    case 'ema':
    case 'rsi':
    case 'atr':
    case 'supertrend':
      return 4 * (spec.params[0] ?? 14)
    case 'macd':
      return 4 * ((spec.params[1] ?? 26) + (spec.params[2] ?? 9))
    case 'hma':
      return (spec.params[0] ?? 9) + Math.ceil(Math.sqrt(spec.params[0] ?? 9))
    case 'stoch':
      return (spec.params[0] ?? 14) + (spec.params[1] ?? 1) + (spec.params[2] ?? 3)
    case 'keltner':
      return 4 * Math.max(spec.params[0] ?? 20, spec.params[2] ?? 10)
    case 'stochrsi':
      return 4 * (spec.params[2] ?? 14) + (spec.params[3] ?? 14) + (spec.params[0] ?? 3) + (spec.params[1] ?? 3)
    case 'adx':
      return 4 * ((spec.params[0] ?? 14) + (spec.params[1] ?? 14))
    case 'vwap':
    case 'obv':
      return 0
    case 'plot': {
      const n = nodeOf(spec)
      return n ? formulaWarmup(n) : 0
    }
  }
}

// ---- The building blocks, each as TradingView defines it ----------------------------------------------

type Num = number | null

/** ta.sma: the mean of the last `len` values; null until there are `len`. */
export function sma(src: readonly Num[], len: number): Num[] {
  const out: Num[] = new Array(src.length).fill(null)
  let sum = 0
  let count = 0
  for (let i = 0; i < src.length; i++) {
    const v = src[i]
    if (v === null || v === undefined) {
      sum = 0
      count = 0
      continue
    }
    sum += v
    count++
    if (count > len) sum -= src[i - len] as number
    if (count >= len) out[i] = sum / len
  }
  return out
}

/** ta.ema: alpha 2/(len+1), started from the SMA of the first `len` values (as ta.rma is). */
export function ema(src: readonly Num[], len: number): Num[] {
  return smooth(src, len, 2 / (len + 1))
}

/** ta.rma (Wilder's average, used by RSI and ATR): alpha 1/len, started from the SMA of the first `len` values. */
export function rma(src: readonly Num[], len: number): Num[] {
  return smooth(src, len, 1 / len)
}

function smooth(src: readonly Num[], len: number, alpha: number): Num[] {
  const out: Num[] = new Array(src.length).fill(null)
  let prev: number | null = null
  let seed = 0
  let count = 0
  for (let i = 0; i < src.length; i++) {
    const v = src[i]
    if (v === null || v === undefined) continue
    if (prev === null) {
      seed += v
      count++
      if (count === len) {
        prev = seed / len
        out[i] = prev
      }
      continue
    }
    prev = alpha * v + (1 - alpha) * prev
    out[i] = prev
  }
  return out
}

/** ta.stdev with its default (biased: divides by len, as TradingView's Bollinger Bands do). */
export function stdev(src: readonly Num[], len: number): Num[] {
  const mean = sma(src, len)
  return src.map((_, i) => {
    const m = mean[i]
    if (m === null || m === undefined) return null
    let s = 0
    for (let k = i - len + 1; k <= i; k++) s += ((src[k] as number) - m) ** 2
    return Math.sqrt(s / len)
  })
}

/** ta.tr(true): the first candle's range is high - low. */
export function trueRange(c: readonly Candle[]): number[] {
  return c.map((k, i) => {
    const prev = c[i - 1]
    if (!prev) return k.h - k.l
    return Math.max(k.h - k.l, Math.abs(k.h - prev.c), Math.abs(k.l - prev.c))
  })
}

/** ta.rsi: Wilder's averages of gains and losses; 100 when there were no losses, 0 when there were no gains. */
export function rsi(src: readonly number[], len: number): Num[] {
  const up: Num[] = src.map((v, i) => (i === 0 ? null : Math.max(v - (src[i - 1] as number), 0)))
  const down: Num[] = src.map((v, i) => (i === 0 ? null : Math.max((src[i - 1] as number) - v, 0)))
  const u = rma(up, len)
  const d = rma(down, len)
  return src.map((_, i) => {
    const a = u[i]
    const b = d[i]
    if (a === null || a === undefined || b === null || b === undefined) return null
    if (b === 0) return 100
    if (a === 0) return 0
    return 100 - 100 / (1 + a / b)
  })
}

/** ta.wma: weights 1..len, the newest heaviest; null until `len` values in a row. */
export function wma(src: readonly Num[], len: number): Num[] {
  return src.map((_, i) => {
    if (i < len - 1) return null
    let s = 0
    let w = 0
    for (let k = 0; k < len; k++) {
      const v = src[i - len + 1 + k]
      if (v === null || v === undefined) return null
      s += (k + 1) * v
      w += k + 1
    }
    return s / w
  })
}

/** ta.hma: wma(2 × wma(src, len/2) − wma(src, len), floor(√len)), len/2 rounded down as Pine's int division. */
export function hma(src: readonly Num[], len: number): Num[] {
  const half = wma(src, Math.max(1, Math.floor(len / 2)))
  const full = wma(src, len)
  const diff = half.map((a, i) => (a === null || full[i] === null || full[i] === undefined ? null : 2 * a - (full[i] as number)))
  return wma(diff, Math.max(1, Math.floor(Math.sqrt(len))))
}

/** ta.stoch(src, high, low, len): where src sits in the window's range, 0 to 100; na when the range is 0 (Pine's x / 0). */
export function stochOf(src: readonly Num[], high: readonly Num[], low: readonly Num[], len: number): Num[] {
  return src.map((v, i) => {
    if (i < len - 1 || v === null || v === undefined) return null
    let hi = -Infinity
    let lo = Infinity
    for (let k = i - len + 1; k <= i; k++) {
      const a = high[k]
      const b = low[k]
      if (a === null || a === undefined || b === null || b === undefined) return null
      hi = Math.max(hi, a)
      lo = Math.min(lo, b)
    }
    return hi === lo ? null : (100 * (v - lo)) / (hi - lo)
  })
}

/**
 * ta.dmi(diLength, adxSmoothing): +DI and -DI from Wilder's averages of the directional moves over ta.tr (na on the
 * first candle), each held at its last value when the range average is 0 (fixnan); ADX is Wilder's average of
 * |+DI − -DI| / (+DI + -DI), times 100.
 */
export function dmi(c: readonly Candle[], len: number, adxLen: number): { plus: Num[]; minus: Num[]; adx: Num[] } {
  const plusDM: Num[] = c.map((k, i) => {
    const p = c[i - 1]
    if (!p) return null
    const up = k.h - p.h
    const down = p.l - k.l
    return up > down && up > 0 ? up : 0
  })
  const minusDM: Num[] = c.map((k, i) => {
    const p = c[i - 1]
    if (!p) return null
    const up = k.h - p.h
    const down = p.l - k.l
    return down > up && down > 0 ? down : 0
  })
  const tr: Num[] = trueRange(c).map((v, i) => (i === 0 ? null : v))
  const trur = rma(tr, len)
  const held = (dm: Num[]): Num[] => {
    const avg = rma(dm, len)
    let last: Num = null
    return avg.map((a, i) => {
      const t = trur[i]
      if (a === null || a === undefined || t === null || t === undefined) return null
      if (t !== 0) last = (100 * a) / t
      return last
    })
  }
  const plus = held(plusDM)
  const minus = held(minusDM)
  const dx: Num[] = plus.map((p, i) => {
    const m = minus[i]
    if (p === null || m === null || m === undefined) return null
    const sum = p + m
    return Math.abs(p - m) / (sum === 0 ? 1 : sum)
  })
  const adx = rma(dx, adxLen).map(v => (v === null ? null : 100 * v))
  return { plus, minus, adx }
}

/** ta.obv: a running total of volume, added on a higher close, taken off on a lower one; starts at 0. */
export function obv(c: readonly Candle[]): Num[] {
  let total = 0
  return c.map((k, i) => {
    const p = c[i - 1]
    if (p) total += Math.sign(k.c - p.c) * k.v
    return total
  })
}

function highest(c: readonly Candle[], len: number): Num[] {
  return c.map((_, i) => {
    if (i < len - 1) return null
    let m = -Infinity
    for (let k = i - len + 1; k <= i; k++) m = Math.max(m, (c[k] as Candle).h)
    return m
  })
}

function lowest(c: readonly Candle[], len: number): Num[] {
  return c.map((_, i) => {
    if (i < len - 1) return null
    let m = Infinity
    for (let k = i - len + 1; k <= i; k++) m = Math.min(m, (c[k] as Candle).l)
    return m
  })
}

/** VWAP anchored to each UTC day (TradingView's "Session" anchor on a 24/7 market): typical price hlc3 by volume. */
export function vwap(c: readonly Candle[]): Num[] {
  let day = -1
  let pv = 0
  let vol = 0
  return c.map(k => {
    const d = Math.floor(k.t / 86_400_000)
    if (d !== day) {
      day = d
      pv = 0
      vol = 0
    }
    pv += ((k.h + k.l + k.c) / 3) * k.v
    vol += k.v
    return vol > 0 ? pv / vol : null
  })
}

/**
 * ta.supertrend(factor, atrLength) with hl2 as the source: bands at hl2 ± factor × ATR that only tighten,
 * the line on the lower band while price holds above it (side 1) and on the upper band after a close below (-1).
 */
export function supertrend(c: readonly Candle[], len: number, factor: number): { line: Num[]; side: (1 | -1 | null)[] } {
  const atr = rma(trueRange(c), len)
  const line: Num[] = new Array(c.length).fill(null)
  const side: (1 | -1 | null)[] = new Array(c.length).fill(null)
  let upper = 0
  let lower = 0
  let dir: 1 | -1 | null = null
  let prevLine: number | null = null
  for (let i = 0; i < c.length; i++) {
    const k = c[i] as Candle
    const a = atr[i]
    if (a === null || a === undefined) continue
    const mid = (k.h + k.l) / 2
    let up = mid + factor * a
    let lo = mid - factor * a
    const prevClose = (c[i - 1] ?? k).c
    if (dir !== null) {
      lo = lo > lower || prevClose < lower ? lo : lower
      up = up < upper || prevClose > upper ? up : upper
    }
    // TradingView's direction: 1 starts it on the upper band; -1 is the line under price.
    let tv: 1 | -1
    if (dir === null) tv = 1
    else if (prevLine === upper) tv = k.c > up ? -1 : 1
    else tv = k.c < lo ? 1 : -1
    upper = up
    lower = lo
    dir = tv
    prevLine = tv === -1 ? lo : up
    line[i] = prevLine
    side[i] = tv === -1 ? 1 : -1
  }
  return { line, side }
}

/** The study for a spec over these candles. */
export function compute(spec: Spec, candles: readonly Candle[]): Study {
  const closes = candles.map(k => k.c)
  const p = spec.params
  const base = { id: specId(spec), label: specLabel(spec), kind: spec.kind, pane: paneOf(spec) }
  switch (spec.kind) {
    case 'plot': {
      const n = nodeOf(spec)
      return { ...base, series: [{ name: specLabel(spec), values: n ? evalFormula(n, candles) : candles.map(() => null), style: 'line' }] }
    }
    case 'sma':
      return { ...base, series: [{ name: specLabel(spec), values: sma(closes, p[0] ?? 20), style: 'line' }] }
    case 'ema':
      return { ...base, series: [{ name: specLabel(spec), values: ema(closes, p[0] ?? 20), style: 'line' }] }
    case 'hma':
      return { ...base, series: [{ name: specLabel(spec), values: hma(closes, p[0] ?? 9), style: 'line' }] }
    case 'keltner': {
      // TradingView's Keltner Channels defaults: EMA basis, bands at mult × ta.atr(atrLength).
      const mid = ema(closes, p[0] ?? 20)
      const atr = rma(trueRange(candles), p[2] ?? 10)
      const mult = p[1] ?? 2
      const at = (sign: number) => mid.map((m, i) => (m === null || atr[i] === null ? null : m + sign * mult * (atr[i] as number)))
      return {
        ...base,
        series: [
          { name: 'upper', values: at(1), style: 'line' },
          { name: 'basis', values: mid, style: 'dash' },
          { name: 'lower', values: at(-1), style: 'line' },
        ],
        fill: [0, 2],
      }
    }
    case 'stochrsi':
    case 'stoch': {
      // Stoch RSI: ta.stoch(rsi, rsi, rsi, len); Stoch: ta.stoch(close, high, low, len). %K is its SMA, %D the SMA of %K.
      const [kLen, dLen, raw] =
        spec.kind === 'stochrsi'
          ? (() => {
              const r = rsi(closes, p[2] ?? 14)
              return [p[0] ?? 3, p[1] ?? 3, stochOf(r, r, r, p[3] ?? 14)] as const
            })()
          : [p[1] ?? 1, p[2] ?? 3, stochOf(closes, candles.map(k => k.h), candles.map(k => k.l), p[0] ?? 14)] as const
      const k = sma(raw, kLen)
      const d = sma(k, dLen)
      return {
        ...base,
        series: [
          { name: '%K', values: k, style: 'line' },
          { name: '%D', values: d, style: 'line', tone: 'alt' },
        ],
        scale: { min: 0, max: 100, levels: [20, 50, 80] },
      }
    }
    case 'adx': {
      const r = dmi(candles, p[1] ?? 14, p[0] ?? 14)
      return {
        ...base,
        series: [
          { name: 'ADX', values: r.adx, style: 'line' },
          { name: '+DI', values: r.plus, style: 'line', tone: 'up' },
          { name: '-DI', values: r.minus, style: 'line', tone: 'down' },
        ],
        // A dotted guide at 25, where many read a trend as strong.
        scale: { min: NaN, max: NaN, levels: [25] },
      }
    }
    case 'obv':
      return { ...base, series: [{ name: 'OBV', values: obv(candles), style: 'line' }] }
    case 'bb': {
      const len = p[0] ?? 20
      const mult = p[1] ?? 2
      const mid = sma(closes, len)
      const dev = stdev(closes, len)
      const at = (sign: number) => mid.map((m, i) => (m === null || dev[i] === null ? null : m + sign * mult * (dev[i] as number)))
      return {
        ...base,
        series: [
          { name: 'upper', values: at(1), style: 'line' },
          { name: 'basis', values: mid, style: 'dash' },
          { name: 'lower', values: at(-1), style: 'line' },
        ],
        fill: [0, 2],
      }
    }
    case 'vwap':
      return { ...base, series: [{ name: 'VWAP', values: vwap(candles), style: 'line' }] }
    case 'donchian': {
      const len = p[0] ?? 20
      const hi = highest(candles, len)
      const lo = lowest(candles, len)
      const mid = hi.map((h, i) => (h === null || lo[i] === null ? null : (h + (lo[i] as number)) / 2))
      return {
        ...base,
        series: [
          { name: 'upper', values: hi, style: 'line' },
          { name: 'middle', values: mid, style: 'dash' },
          { name: 'lower', values: lo, style: 'line' },
        ],
        fill: [0, 2],
      }
    }
    case 'supertrend': {
      const st = supertrend(candles, p[0] ?? 10, p[1] ?? 3)
      return { ...base, series: [{ name: 'Supertrend', values: st.line, style: 'line' }], side: st.side }
    }
    case 'rsi':
      return { ...base, series: [{ name: specLabel(spec), values: rsi(closes, p[0] ?? 14), style: 'line' }], scale: { min: 0, max: 100, levels: [30, 50, 70] } }
    case 'atr':
      return { ...base, series: [{ name: specLabel(spec), values: rma(trueRange(candles), p[0] ?? 14), style: 'line' }] }
    case 'macd': {
      const fast = ema(closes, p[0] ?? 12)
      const slow = ema(closes, p[1] ?? 26)
      const line = fast.map((f, i) => (f === null || slow[i] === null ? null : f - (slow[i] as number)))
      const avg = ema(line, p[2] ?? 9)
      const hist = line.map((m, i) => (m === null || avg[i] === null ? null : m - (avg[i] as number)))
      // TradingView names the second line "Signal"; the desk says "avg" (its EMA), the same line.
      return {
        ...base,
        series: [
          { name: 'hist', values: hist, style: 'hist' },
          { name: 'MACD', values: line, style: 'line' },
          { name: `avg ${p[2] ?? 9}`, values: avg, style: 'line', tone: 'alt' },
        ],
        scale: { min: NaN, max: NaN, levels: [0] },
      }
    }
  }
}

/** The last `count` points of a study, so it lines up with the candles drawn. */
export function tail(study: Study, count: number): Study {
  const cut = <T>(a: readonly T[]) => a.slice(Math.max(0, a.length - count))
  return { ...study, series: study.series.map(s => ({ ...s, values: cut(s.values) })), side: study.side ? cut(study.side) : undefined }
}

/** "EMA 50 64,210" style values at candle `i` (from the end: 0 is the last), for legends and Claude. */
export function valuesAt(study: Study, back: number, fmt: (n: number) => string): string {
  const parts = study.series
    .map(s => {
      const v = s.values[s.values.length - 1 - back]
      if (v === null || v === undefined) return null
      return study.series.length === 1 ? fmt(v) : `${s.name} ${fmt(v)}`
    })
    .filter((x): x is string => x !== null)
  return parts.length > 0 ? parts.join('  ') : 'warming up'
}

/** 1.23M, 456K, -12.3B: volume totals in a few characters. */
export function fmtCompact(n: number): string {
  const a = Math.abs(n)
  for (const [d, u] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) if (a >= d) return `${(n / d).toFixed(a / d >= 100 ? 0 : a / d >= 10 ? 1 : 2)}${u}`
  return a >= 10 ? n.toFixed(0) : n.toFixed(2)
}

/** Lower-pane value format: 0-100 oscillators with one decimal, OBV compact, others like prices. */
export function fmtStudy(study: Study, n: number, fmtPrice: (n: number) => string): string {
  if (study.pctOf) {
    const p = (n / study.pctOf - 1) * 100
    return (p > 0 ? '+' : p < 0 ? '-' : '') + Math.abs(p).toFixed(2) + '%'
  }
  if (study.kind === 'rsi' || study.kind === 'stochrsi' || study.kind === 'stoch' || study.kind === 'adx') return n.toFixed(1)
  if (study.kind === 'obv') return fmtCompact(n)
  if (study.kind === 'macd' || (study.kind === 'plot' && study.pane === 'lower')) return Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toPrecision(3)
  return fmtPrice(n)
}

/** The help list: one line per kind. */
export function helpLines(): string[] {
  return (Object.keys(KINDS) as Kind[]).map(k => `${example(k)}: ${KINDS[k].what}`)
}

/** What a command or Claude asks to change: specs or preset names to add, specs or kinds to remove, or clear. */
export type Change = { add?: readonly string[]; remove?: readonly string[]; clear?: boolean }

/**
 * The list after a change, and a plain note for each part that did not apply. "remove ema" takes every EMA off;
 * "remove ema 50" only that one. A preset name ("trend") adds its set. Limits: MAX_STUDIES, MAX_LOWER lower panes.
 */
export function changeList(ids: readonly string[], change: Change): { ids: string[]; added: string[]; removed: string[]; notes: string[] } {
  let list = change.clear ? [] : [...ids]
  const removed = change.clear ? [...ids] : []
  const added: string[] = []
  const notes: string[] = []
  for (const raw of change.remove ?? []) {
    const text = raw.trim().toLowerCase()
    const word = ALIASES[text]
    const parsed = parseSpec(text)
    const gone = word ? list.filter(id => id.split(' ')[0] === word) : 'error' in parsed ? [] : list.filter(id => id === specId(parsed))
    if (gone.length === 0) notes.push(`${raw.trim()} is not on the chart.`)
    list = list.filter(id => !gone.includes(id))
    removed.push(...gone)
  }
  const isLower = (id: string) => {
    const s = parseSpec(id)
    return !('error' in s) && paneOf(s) === 'lower'
  }
  for (const raw of change.add ?? []) {
    const preset = PRESETS[raw.trim().toLowerCase()]
    for (const one of preset ?? [raw]) {
      const s = parseSpec(one)
      if ('error' in s) {
        notes.push(s.error)
        continue
      }
      const id = specId(s)
      if (list.includes(id)) continue
      if (list.length >= MAX_STUDIES) {
        notes.push(`The chart holds ${MAX_STUDIES} indicators at most; remove one to add ${specLabel(s)}.`)
        continue
      }
      if (paneOf(s) === 'lower' && list.filter(isLower).length >= MAX_LOWER) {
        const onChart = list.filter(isLower).map(id => specLabel(parseSpec(id) as Spec))
        notes.push(`Two lower panes at most; remove ${onChart.join(' or ')} to add ${specLabel(s)}.`)
        continue
      }
      list.push(id)
      added.push(id)
    }
  }
  return { ids: list, added, removed, notes }
}

/** The specs behind a saved list; anything that no longer parses is dropped. */
export function specsOf(ids: readonly string[] | null | undefined): Spec[] {
  return (ids ?? []).map(id => parseSpec(id)).filter((s): s is Spec => !('error' in s))
}

/** "EMA 20 · EMA 50 · RSI 14", or "none". */
export function listText(ids: readonly string[] | null | undefined): string {
  const specs = specsOf(ids)
  return specs.length > 0 ? specs.map(specLabel).join(' · ') : 'none'
}
