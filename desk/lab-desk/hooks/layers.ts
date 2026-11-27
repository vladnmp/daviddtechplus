// Layers: Claude's own results painted on the chart. A line (values by time or by candle), pins on candles and
// shaded time spans, under a name, per coin. Lines become studies, so the legend, the CSV, the terminal chart and
// the picture draw them like indicators; pins and spans become marks for the drawing only (never stored as marks).

import type { Candle, Layer, LayerPin, LayerSpan, Mark } from '../types'
import type { Study } from './indicators'
import type { Ghost } from './draw'

export const MAX_LAYERS = 8
export const MAX_POINTS = 2000
export const MAX_PINS = 200
export const MAX_SPANS = 20
/** Layers kept across every coin; the oldest go first. */
export const MAX_ALL_LAYERS = 32
const NAME_MAX = 24

/** Default layer inks, apart from the indicator slot inks and the Compare blue. */
export const LAYER_INKS = ['#2962ff', '#00bcd4', '#e91e63', '#8bc34a', '#ff5722', '#9c27b0'] as const

const NAMED: Record<string, string> = {
  blue: '#2962ff',
  orange: '#ff9800',
  green: '#4caf50',
  red: '#f23645',
  purple: '#9c27b0',
  yellow: '#ffeb3b',
  gray: '#9598a1',
  grey: '#9598a1',
  teal: '#00bcd4',
  cyan: '#00bcd4',
  pink: '#e91e63',
  white: '#d1d4dc',
  lime: '#8bc34a',
}

/** A hex color from "#f80", "#ff8800" or a plain name; null for anything else. */
export function inkOf(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  if (NAMED[s]) return NAMED[s]
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  return /^#[0-9a-f]{6}$/.test(s) ? s : null
}

/** A time in ms from ms, seconds, or an ISO text (UTC when it names no zone); null when unreadable. */
export function timeOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v
  if (typeof v !== 'string' || v.trim() === '') return null
  const s = v.trim()
  if (/^\d+(\.\d+)?$/.test(s)) return timeOf(Number(s))
  const zoned = /(z|[+-]\d\d:?\d\d)$/i.test(s) || !/\d[T ]\d/.test(s) ? s : `${s}Z`
  const t = Date.parse(zoned.replace(' ', 'T'))
  return Number.isFinite(t) ? t : null
}

/** The candle a time falls in (open time ≤ t < next open), or null when it is before the first or after the last. */
/** Paths ahead: at most this many, each at most MAX_AHEAD candles long. */
export const MAX_AHEAD_PATHS = 20
export const MAX_AHEAD = 200

/**
 * The newest paths-ahead on this coin whose candle is the last one shown or the one before it (the forming candle
 * after it): drawn to the right of the chart. Older ones are not drawn; the chart has moved on.
 */
export function layerGhost(all: readonly Layer[], coin: string, candles: readonly Candle[]): Ghost | null {
  for (let k = all.length - 1; k >= 0; k--) {
    const l = all[k] as Layer
    if (l.coin !== coin || !l.ahead) continue
    let i = candles.length - 1
    while (i >= 0 && i >= candles.length - 2 && (candles[i] as Candle).t !== l.ahead.t) i--
    if (i < 0 || i < candles.length - 2) continue
    const ink = Number.parseInt((l.ink ?? '#00bcd4').slice(1), 16)
    const n = l.ahead.paths.length
    return { anchor: i, paths: l.ahead.paths, median: l.ahead.median, ink: Number.isFinite(ink) ? ink : 0x00bcd4, label: n > 0 ? `${n} look-alikes` : 'look-alikes' }
  }
  return null
}

export function candleAt(candles: readonly Candle[], t: number): Candle | null {
  if (candles.length === 0) return null
  const first = candles[0] as Candle
  const last = candles[candles.length - 1] as Candle
  const step = candles.length > 1 ? (candles[1] as Candle).t - first.t : 3_600_000
  if (t < first.t || t >= last.t + step) return null
  let lo = 0
  let hi = candles.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((candles[mid] as Candle).t <= t) lo = mid
    else hi = mid - 1
  }
  return candles[lo] ?? null
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

export type LayerChange = { next: Layer[]; notes: string[] }

/**
 * Applies Claude's `layers` input for `coin`: each item adds a layer, or replaces the one with its name. Values by
 * candle are tied to the times of the candles shown now, so a layer stays put when new candles come.
 */
export function addLayers(all: readonly Layer[], coin: string, raw: unknown, candles: readonly Candle[], now: number): LayerChange {
  const notes: string[] = []
  let next = [...all]
  const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []
  for (const item of items) {
    const o = (item ?? {}) as Record<string, unknown>
    const mine = next.filter(l => l.coin === coin)
    const name = clean(o.name, NAME_MAX) || `layer ${mine.length + 1}`
    const was = mine.find(l => l.name.toLowerCase() === name.toLowerCase())
    if (!was && mine.length >= MAX_LAYERS) {
      notes.push(`${MAX_LAYERS} layers at most on ${coin}; "${name}" was not added (remove_layers makes room).`)
      continue
    }
    // Points: by time, or values lined up with the last candles shown.
    let points: [number, number][] = []
    let badTimes = 0
    if (Array.isArray(o.points)) {
      for (const p of o.points as unknown[]) {
        const q = (p ?? {}) as Record<string, unknown>
        const pair = Array.isArray(p) ? (p as unknown[]) : null
        const t = timeOf(pair ? pair[0] : q.time ?? q.t)
        const v = Number(pair ? pair[1] : q.value ?? q.v)
        if (t === null) badTimes++
        else if (Number.isFinite(v)) points.push([t, v])
      }
    } else if (Array.isArray(o.values)) {
      const vals = o.values as unknown[]
      const from = candles.length - vals.length
      vals.forEach((v, k) => {
        const c = candles[from + k]
        const n = v === null ? NaN : Number(v)
        if (c && Number.isFinite(n)) points.push([c.t, n])
      })
      if (from < 0) notes.push(`"${name}": ${-from} value(s) before the first candle shown were left out.`)
    }
    points.sort((a, b) => a[0] - b[0])
    if (points.length > MAX_POINTS) {
      notes.push(`"${name}": kept the last ${MAX_POINTS} of ${points.length} points.`)
      points = points.slice(-MAX_POINTS)
    }
    if (badTimes > 0) notes.push(`"${name}": ${badTimes} point(s) had no readable time (use ms or ISO UTC like 2026-11-24T08:00).`)
    const pins: LayerPin[] = []
    if (Array.isArray(o.pins)) {
      for (const p of (o.pins as unknown[]).slice(0, MAX_PINS)) {
        const q = (p ?? {}) as Record<string, unknown>
        const t = timeOf(q.time ?? q.t)
        if (t === null) continue
        const dir = q.dir === 'down' || q.dir === 'dot' ? q.dir : 'up'
        const price = Number(q.price)
        const until = q.until === undefined ? null : timeOf(q.until)
        pins.push({ t, dir, ...(Number.isFinite(price) && q.price !== null && q.price !== undefined ? { price } : {}), ...(clean(q.label, NAME_MAX) ? { label: clean(q.label, NAME_MAX) } : {}), ...(until !== null ? { until } : {}) })
      }
      if ((o.pins as unknown[]).length > MAX_PINS) notes.push(`"${name}": ${MAX_PINS} pins at most; the rest were left out.`)
    }
    const spans: LayerSpan[] = []
    if (Array.isArray(o.spans)) {
      for (const p of (o.spans as unknown[]).slice(0, MAX_SPANS)) {
        const q = (p ?? {}) as Record<string, unknown>
        const a = timeOf(q.from ?? q.time ?? q.t)
        const b = timeOf(q.to ?? q.time2 ?? q.t2)
        if (a === null || b === null) continue
        spans.push({ t: Math.min(a, b), t2: Math.max(a, b), ...(clean(q.label, NAME_MAX) ? { label: clean(q.label, NAME_MAX) } : {}), ...(q.trade === 'won' || q.trade === 'lost' ? { trade: q.trade } : {}) })
      }
      if ((o.spans as unknown[]).length > MAX_SPANS) notes.push(`"${name}": ${MAX_SPANS} spans at most; the rest were left out.`)
    }
    let ahead: Layer['ahead'] | undefined
    const ah = o.ahead && typeof o.ahead === 'object' ? (o.ahead as { t?: unknown; paths?: unknown; median?: unknown }) : null
    if (ah) {
      const t = timeOf(ah.t)
      const nums = (x: unknown): number[] | null =>
        Array.isArray(x) && x.length > 0 && x.length <= MAX_AHEAD && x.every(v => typeof v === 'number' && Number.isFinite(v)) ? (x as number[]) : null
      const median = nums(ah.median)
      const paths = Array.isArray(ah.paths) ? (ah.paths as unknown[]).slice(0, MAX_AHEAD_PATHS).map(nums).filter((q): q is number[] => q !== null && q.length === median?.length) : []
      if (t !== null && median) ahead = { t, paths, median }
    }
    if (points.length === 0 && pins.length === 0 && spans.length === 0 && !ahead) {
      notes.push(`"${name}" had nothing to draw: give values (one per candle, oldest first), points [{time, value}], pins [{time}] or spans [{from, to}].`)
      continue
    }
    const color = o.color === undefined ? null : inkOf(o.color)
    if (o.color !== undefined && color === null) notes.push(`"${name}": unknown color ${String(o.color)}; used its own.`)
    const used = new Set(next.filter(l => l.coin === coin && l !== was).map(l => l.ink))
    const ink = color ?? was?.ink ?? LAYER_INKS.find(x => !used.has(x)) ?? LAYER_INKS[mine.length % LAYER_INKS.length] ?? '#ff9800'
    const pane = o.pane === 'lower' || o.pane === 'own' ? 'lower' : o.pane === 'price' ? 'price' : paneFor(points, candles)
    const layer: Layer = { coin, name, pane, ink, at: now, ...(points.length > 0 ? { points } : {}), ...(pins.length > 0 ? { pins } : {}), ...(spans.length > 0 ? { spans } : {}), ...(ahead ? { ahead } : {}) }
    next = was ? next.map(l => (l === was ? layer : l)) : [...next, layer]
  }
  if (next.length > MAX_ALL_LAYERS) next = next.slice(-MAX_ALL_LAYERS)
  return { next, notes }
}

/** A line sits on the price chart when its values live where the candles do, else in a pane of its own. */
function paneFor(points: readonly [number, number][], candles: readonly Candle[]): 'price' | 'lower' {
  if (points.length === 0 || candles.length === 0) return 'price'
  let lo = Infinity
  let hi = -Infinity
  for (const c of candles) {
    lo = Math.min(lo, c.l)
    hi = Math.max(hi, c.h)
  }
  const span = hi - lo || Math.abs(hi) * 0.01 || 1
  return points.every(([, v]) => v >= lo - span && v <= hi + span) ? 'price' : 'lower'
}

/** Removes layers on `coin` by name ("all" or "*" for every one); says what went. */
export function removeLayers(all: readonly Layer[], coin: string, names: readonly string[]): LayerChange {
  const want = names.map(n => n.trim().toLowerCase()).filter(n => n !== '')
  const isAll = want.some(n => n === 'all' || n === '*')
  const gone = all.filter(l => l.coin === coin && (isAll || want.includes(l.name.toLowerCase())))
  const next = all.filter(l => !gone.includes(l))
  return { next, notes: [gone.length > 0 ? `Layers removed on ${coin}: ${gone.map(l => l.name).join(', ')}.` : `No layer named ${names.join(', ')} on ${coin}.`] }
}

/** Points per candle: the last point inside each candle, held across gaps no wider than the points' own spacing. */
export function alignPoints(points: readonly [number, number][], candles: readonly Candle[]): (number | null)[] {
  const out: (number | null)[] = candles.map(() => null)
  if (points.length === 0 || candles.length === 0) return out
  const gaps = points.slice(1).map((p, k) => p[0] - (points[k] as [number, number])[0]).filter(g => g > 0).sort((a, b) => a - b)
  const spacing = gaps.length > 0 ? (gaps[Math.floor(gaps.length / 2)] as number) : 0
  const step = candles.length > 1 ? (candles[1] as Candle).t - (candles[0] as Candle).t : 3_600_000
  let k = -1
  candles.forEach((c, i) => {
    const end = c.t + step
    while (k + 1 < points.length && (points[k + 1] as [number, number])[0] < end) k++
    const p = points[k]
    if (!p) return
    if (p[0] >= c.t || c.t - p[0] < spacing) out[i] = p[1]
  })
  // Nothing held past the last point by more than its spacing (a line that stops, stops).
  return out
}

/** The coin's line layers as studies over these candles (only what falls on them: replay hides the rest). */
export function layerStudies(layers: readonly Layer[], coin: string, candles: readonly Candle[]): Study[] {
  if (candles.length === 0) return []
  return layers
    .filter(l => l.coin === coin && (l.points?.length ?? 0) > 0)
    .map(
      (l): Study => ({
        id: `layer ${l.name}`,
        label: l.name,
        kind: 'plot',
        pane: l.pane,
        series: [{ name: l.name, values: alignPoints(l.points ?? [], candles), style: 'line' }],
        ...(l.ink ? { ink: l.ink } : {}),
      }),
    )
    .filter(s => s.series[0]?.values.some(v => v !== null))
}

/** The coin's pins and spans as marks on these candles: pins snapped to their candle; spans cut to the chart. */
export function layerMarks(layers: readonly Layer[], coin: string, candles: readonly Candle[]): Mark[] {
  const out: Mark[] = []
  if (candles.length === 0) return out
  const first = candles[0] as Candle
  const last = candles[candles.length - 1] as Candle
  for (const l of layers.filter(x => x.coin === coin)) {
    for (const s of l.spans ?? []) {
      const a = candleAt(candles, Math.max(s.t, first.t))
      const b = candleAt(candles, Math.min(s.t2, last.t))
      if (!a || !b || s.t > last.t || s.t2 < first.t) continue
      // A trade cut by the chart's edge keeps the band: its line would start or end at the wrong close.
      const whole = s.trade !== undefined && s.t >= first.t && s.t2 <= last.t
      out.push({ coin, kind: 'span', price: 0, t: a.t, t2: b.t, label: s.label ?? '', ...(l.ink ? { ink: l.ink } : {}), ...(whole ? { trade: s.trade } : {}) })
    }
    for (const p of l.pins ?? []) {
      const c = candleAt(candles, p.t)
      if (!c) continue
      // A trade that ends after the last candle shown (a replay) keeps its result to itself.
      const label = p.until !== undefined && p.until > last.t ? '' : (p.label ?? '')
      out.push({ coin, kind: 'pin', price: p.price ?? (p.dir === 'up' ? c.l : p.dir === 'down' ? c.h : c.c), t: c.t, dir: p.dir, label, ...(l.ink ? { ink: l.ink } : {}) })
    }
  }
  return out
}

/** One line per coin for Claude: what each layer holds and where it draws. */
export function layersLine(layers: readonly Layer[], coin: string, studies: readonly Study[]): string {
  const mine = layers.filter(l => l.coin === coin)
  if (mine.length === 0) return ''
  const shown = new Set(studies.map(s => s.id))
  const parts = mine.map(l => {
    const bits: string[] = []
    if (l.points?.length) bits.push(`line, ${l.points.length} points, ${l.pane === 'price' ? 'on the price chart' : 'own pane'}${shown.has(`layer ${l.name}`) ? '' : ', none on the candles shown'}`)
    if (l.pins?.length) bits.push(`${l.pins.length} pin${l.pins.length === 1 ? '' : 's'}`)
    const trades = (l.spans ?? []).filter(s => s.trade)
    const plain = (l.spans?.length ?? 0) - trades.length
    // No count or tally: in a replay some of these trades end after the candles shown.
    if (trades.length > 0) bits.push('trades as lines from entry to exit close')
    if (plain > 0) bits.push(`${plain} span${plain === 1 ? '' : 's'}`)
    return `${l.name} (${bits.join(', ')})`
  })
  return `Layers: ${parts.join(' · ')}.`
}

/** Saved layers read back: whatever does not fit the shape is dropped. */
export function layersFromStore(saved: unknown): Layer[] {
  if (!Array.isArray(saved)) return []
  return (saved as unknown[]).filter((x): x is Layer => {
    const o = x as Partial<Layer> | null
    return (
      !!o &&
      typeof o.coin === 'string' &&
      typeof o.name === 'string' &&
      (o.pane === 'price' || o.pane === 'lower') &&
      (o.points === undefined || (Array.isArray(o.points) && o.points.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number')))) &&
      (o.pins === undefined || Array.isArray(o.pins)) &&
      (o.spans === undefined || Array.isArray(o.spans))
    )
  })
}
