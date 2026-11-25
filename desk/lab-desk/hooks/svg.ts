// The desk's desktop chart as one SVG, TradingView-style: a panel with a solid grid, volume, candles,
// indicators over price and in panes under it, a legend that follows the hovered candle (CSS only, the
// frame runs no script), the last price, and the DaviddTech+ range. Pure: no `$`.

import type { Candle, Fan, Mark } from '../types'
import { fmtPct, fmtPrice, fmtTime } from './data'
import { fmtMark } from './marks'
import type { Ghost, Palette } from './draw'
import { PALETTES, fmtTick, ghostRange, niceTicks } from './draw'
export { fmtTick, niceTicks } from './draw'
import { fanAt, fanRange } from './forecast'
import type { Study } from './indicators'
import { compareStudy, fmtCompact, fmtStudy, tail } from './indicators'
import { fibPrices } from './marks'

export type Theme = 'dark' | 'light'

export type DeskInput = {
  candles: readonly Candle[]
  /** Candles back from the last one that the legend shows; 0 is the last. */
  cursor: number
  fan: Fan | null
  palette?: Palette
  /** Studies computed over all of `candles`, in the order added. */
  studies?: readonly Study[]
  theme?: Theme
  /** Levels, zones and notes for this coin. */
  marks?: readonly Mark[]
  /** Units per candle: smaller shows more candles (zoomed out). Default DEFAULT_PITCH. */
  pitch?: number
  /** Another coin's candles for the Compare line (same interval). */
  compare?: { coin: string; candles: readonly Candle[]; from: number } | null
  /** Paths ahead (moments like now), drawn right of the candles when no DaviddTech+ range shows. */
  ghost?: Ghost | null
}

const THEMES = {
  dark: { panel: '#16181c', grid: '#262a31', text: '#9198a1', bright: '#d1d4dc', cross: '#9198a1' },
  light: { panel: '#fafafa', grid: '#e9ecf0', text: '#6b7280', bright: '#1f2937', cross: '#6b7280' },
} as const

/** Indicator inks in slot order; slots 5 and 6 are Supertrend's below / above price. */
export const INKS = {
  classic: ['#b8860b', '#a46bf5', '#db6b00', '#8d8d99', '#7f9a2e', '#e0559a'],
  colorblind: ['#8c8c00', '#9b6fe0', '#cc6677', '#aa4499', '#009e73', '#c45fa0'],
} as const

export const W = 720
const LEGEND = 24
const PRICE_H = 300
const LOWER_H = 92
const TIME_H = 22
const SCALE = 64
/** Units per candle at the default zoom; DeskInput.pitch changes it. */
export const DEFAULT_PITCH = 8
const CH = 6.6 // one 11px monospace character
export const MAX_SVG = 131_072

export function svgHeight(lower: number): number {
  return LEGEND + PRICE_H + LOWER_H * lower + TIME_H
}

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0')
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString()

const MIN = 60_000
const STEPS = [5, 15, 30, 60, 120, 180, 240, 360, 720, 1440, 2880, 4320, 5760, 10080, 20160, 43200].map(m => m * MIN)

/** Candle indexes where a round time falls (midnights first), at most six, for the time scale and grid. */
export function timeTicks(candles: readonly Candle[], max = 6): { i: number; isDay: boolean }[] {
  const first = candles[0]
  const last = candles[candles.length - 1]
  if (!first || !last) return []
  const span = Math.max(1, last.t - first.t)
  const step = STEPS.find(s => span / s <= max) ?? 43200 * MIN
  const out: { i: number; isDay: boolean }[] = []
  for (let i = 1; i < candles.length; i++) {
    const a = Math.floor((candles[i - 1] as Candle).t / step)
    const b = Math.floor((candles[i] as Candle).t / step)
    if (b !== a) out.push({ i, isDay: (candles[i] as Candle).t % 86_400_000 === 0 || step >= 86_400_000 })
  }
  return out.slice(-max)
}

function tickLabel(t: number, interval: string, isDay: boolean): string {
  const d = new Date(t)
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] ?? ''
  if (isDay || interval === '1d' || interval === '1w') return `${d.getUTCDate()} ${month}`
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** "M x y L x y ..." over the non-null runs; `breakAt(i)` starts a new run (VWAP's day restarts). */
function pathOf(values: readonly (number | null)[], X: (i: number) => number, Y: (v: number) => number, breakAt?: (i: number) => boolean): string {
  let d = ''
  let pen = false
  values.forEach((v, i) => {
    if (v === null || v === undefined || !Number.isFinite(v)) {
      pen = false
      return
    }
    if (pen && breakAt?.(i)) pen = false
    d += `${pen ? 'L' : 'M'}${f1(X(i))} ${f1(Y(v))}`
    pen = true
  })
  return d
}

/** A filled area between two series over their shared non-null runs. */
function areaOf(a: readonly (number | null)[], b: readonly (number | null)[], X: (i: number) => number, Y: (v: number) => number): string {
  let d = ''
  let run: number[] = []
  const flush = () => {
    if (run.length > 1) {
      d += 'M' + run.map(i => `${f1(X(i))} ${f1(Y(a[i] as number))}`).join('L')
      d += 'L' + [...run].reverse().map(i => `${f1(X(i))} ${f1(Y(b[i] as number))}`).join('L') + 'Z'
    }
    run = []
  }
  a.forEach((v, i) => {
    if (v === null || v === undefined || b[i] === null || b[i] === undefined) flush()
    else run.push(i)
  })
  flush()
  return d
}

type Pane = { study: Study; y0: number; lo: number; hi: number; Y: (v: number) => number; labels: { v: number; text: string }[] }

function lowerPane(study: Study, y0: number): Pane {
  let lo = Infinity
  let hi = -Infinity
  for (const s of study.series) for (const v of s.values) if (v !== null && Number.isFinite(v)) {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  if (!Number.isFinite(lo)) {
    lo = 0
    hi = 1
  }
  let labels: { v: number; text: string }[]
  const fixed = study.scale && Number.isFinite(study.scale.min) ? study.scale : null
  if (fixed) {
    // 0-100 oscillators (RSI, Stoch, Stoch RSI): the fixed scale and its guide levels.
    lo = fixed.min
    hi = fixed.max
    labels = [...fixed.levels].sort((a, b) => b - a).map(v => ({ v, text: String(v) }))
  } else if (study.kind === 'macd') {
    // Round ticks either side of zero: "10 / 0 / -10".
    const m = Math.max(Math.abs(lo), Math.abs(hi)) * 1.08 || 1
    const s = niceTicks(0, m * 0.92, 2).at(-1) || m * 0.8
    lo = -m
    hi = m
    labels = [s, 0, -s].map(v => ({ v, text: fmtTick(v, s) }))
  } else {
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1
    lo -= pad
    hi += pad
    // Round ticks inside the pane ("40 / 20"); OBV in its short form ("1.2M").
    const ticks = niceTicks(lo + pad / 2, hi - pad / 2, 3)
    const step = (ticks[1] ?? 0) - (ticks[0] ?? 0) || Math.abs(ticks[0] ?? 1)
    labels = ticks.map(v => ({ v, text: study.kind === 'obv' ? fmtCompact(v) : fmtTick(v, step) }))
  }
  const top = y0 + 18
  const h = LOWER_H - 24
  const Y = (v: number) => top + ((hi - v) / (hi - lo)) * h
  return { study, y0, lo, hi, Y, labels }
}

export type SvgDetail = 'full' | 'no-hover-values' | 'no-hover'

/** The chart as an SVG document; falls back to less hover detail to stay under the frame's size limit. */
export function deskSvg(input: DeskInput, interval: string, coin: string, fanLabel: string | null): string {
  for (const detail of ['full', 'no-hover-values', 'no-hover'] as const) {
    const svg = deskSvgAt(input, interval, coin, fanLabel, detail)
    if (svg.length <= (detail === 'no-hover' ? MAX_SVG : 110_000)) return svg
  }
  return deskSvgAt({ ...input, studies: [] }, interval, coin, fanLabel, 'no-hover')
}

export function deskSvgAt(input: DeskInput, interval: string, coin: string, fanLabel: string | null, detail: SvgDetail): string {
  const pal = input.palette ?? PALETTES.classic
  const isCb = pal === PALETTES.colorblind
  const inks = isCb ? INKS.colorblind : INKS.classic
  const th = THEMES[input.theme ?? 'dark']
  const PITCH = Math.max(2, Math.min(24, input.pitch ?? DEFAULT_PITCH))
  const BODY = Math.max(1, Math.round(PITCH * 0.7 * 10) / 10)
  const studies = input.studies ?? []
  const lowers = studies.filter(s => s.pane === 'lower').slice(0, 2)
  const prices = studies.filter(s => s.pane === 'price')
  const H = svgHeight(lowers.length)
  const plotRight = W - SCALE
  const hasFan = input.fan !== null && input.candles.length > 0
  const ghost = !hasFan && input.ghost && input.candles[input.ghost.anchor] ? input.ghost : null
  // Paths ahead keep the candles' own spacing, so ten candles ahead look ten candles long.
  const ghostAhead = ghost ? ghost.median.length - (input.candles.length - 1 - ghost.anchor) : 0
  const fanW = hasFan ? Math.round(plotRight * 0.22) : ghost && ghostAhead > 0 ? Math.min(Math.round(plotRight * 0.3), Math.max(100, ghostAhead * PITCH + 14)) : 0
  const plotW = plotRight - fanW
  const n = Math.max(1, Math.floor(plotW / PITCH))
  const candles = input.candles.slice(-n)
  const cut = (s: Study) => tail(s, candles.length)
  // Compare: the other coin from its anchor candle, as a % line in its own ink.
  const cmp = input.compare ? compareStudy(input.compare.coin, input.candles, input.compare.candles, input.compare.from) : null
  const shownPrices = [...prices, ...(cmp ? [cmp] : [])].map(cut)
  /** Where the legend's last row ends (rows at 16 + 14k): marks keep their labels below it. */
  const legendBottom = 16 + 14 * shownPrices.length + 5
  const cmpShown = shownPrices.find(s => s.pctOf !== undefined)
  const shownLowers = lowers.map(cut)
  const last = candles[candles.length - 1]
  const up = hex(pal.up)
  const down = hex(pal.down)
  const fanInk = hex(pal.fan)

  // Scale on candles and the fan only: a long average far away never squashes the candles.
  let lo = Infinity
  let hi = -Infinity
  for (const c of candles) {
    lo = Math.min(lo, c.l)
    hi = Math.max(hi, c.h)
  }
  if (input.fan && last) {
    const [a, b] = fanRange(input.fan, last.c)
    lo = Math.min(lo, a)
    hi = Math.max(hi, b)
  }
  const gr = ghost && fanW > 0 ? ghostRange(ghost, input.candles) : null
  if (gr) {
    lo = Math.min(lo, gr[0])
    hi = Math.max(hi, gr[1])
  }
  // The Compare line counts in the scale, as on TradingView: both coins stay on screen.
  for (const v of cmpShown?.series[0]?.values ?? []) {
    if (v === null || !Number.isFinite(v)) continue
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  // A level or zone near the candles widens the scale to show it; one far away stays off the chart.
  if (Number.isFinite(lo)) {
    const reach = (hi - lo) * 0.3
    for (const m of input.marks ?? []) {
      if (m.kind === 'note' || m.kind === 'pin' || m.kind === 'span') continue
      for (const p of [m.price, m.price2 ?? m.price]) if (p >= lo - reach && p <= hi + reach) {
        lo = Math.min(lo, p)
        hi = Math.max(hi, p)
      }
    }
  }
  if (!Number.isFinite(lo)) {
    lo = 0
    hi = 1
  }
  if (hi === lo) {
    lo -= Math.abs(lo) * 0.001 || 1
    hi += Math.abs(hi) * 0.001 || 1
  }
  const pad = (hi - lo) * 0.06
  lo -= pad
  hi += pad
  const pTop = LEGEND
  const pBot = LEGEND + PRICE_H
  const Y = (p: number) => pTop + ((hi - p) / (hi - lo)) * PRICE_H
  const x0 = plotW - candles.length * PITCH
  const X = (i: number) => x0 + i * PITCH + PITCH / 2
  const bottom = H - TIME_H

  // Which ink each study wears: line studies take slots 1-4 in order; Supertrend wears 5 and 6.
  const inkOf = new Map<string, number>()
  let slot = 0
  for (const s of studies) if (s.kind !== 'supertrend') inkOf.set(s.id, slot++ % 4)
  const ink = (s: Study) => s.ink ?? inks[inkOf.get(s.id) ?? 0] ?? inks[0]
  const isDashed = (s: Study) => !s.ink && !s.fill && s.series.length === 1 && (inkOf.get(s.id) ?? 0) >= 2
  // ADX-like panes: the main line in the bright text color, +DI / -DI in the candle colors.
  const hasDi = (s: Study) => s.series.some(se => se.tone === 'up' || se.tone === 'down')
  const mainInk = (s: Study) => (hasDi(s) ? th.bright : ink(s))
  const seriesInk = (s: Study, se: Study['series'][number], v?: number): string => {
    const col = ink(s)
    if (se.style === 'hist') return (v ?? 0) >= 0 ? up : down
    if (se.tone === 'up') return up
    if (se.tone === 'down') return down
    if (se.tone === 'alt') return col === inks[3] ? inks[0] : inks[3]
    return mainInk(s)
  }
  /** The legend's values, each in its own line's color (Supertrend in the color of its side). */
  const legendSpans = (s: Study, i: number): string => {
    if (s.kind === 'supertrend') {
      const v = s.series[0]?.values[i]
      if (v === null || v === undefined) return '…'
      return `<tspan fill="${(s.side?.[i] ?? 1) === 1 ? inks[4] : inks[5]}">${esc(fmtStudy(s, v, fmtPrice))}</tspan>`
    }
    const parts = s.series
      .map(se => ({ se, v: se.values[i] }))
      .filter((x): x is { se: Study['series'][number]; v: number } => x.v !== null && x.v !== undefined && Number.isFinite(x.v))
    if (parts.length === 0) return '…'
    return parts.map(x => `<tspan fill="${seriesInk(s, x.se, x.v)}">${esc(fmtStudy(s, x.v, fmtPrice))}</tspan>`).join(' ')
  }

  const out: string[] = []
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="11">`)
  out.push(
    `<style>.g{stroke:${th.grid};stroke-width:1}.t{fill:${th.text}}.b{fill:${th.bright}}.k{fill:${th.panel};fill-opacity:.72}` +
      `.h{display:none;pointer-events:none}.c:hover .h{display:inline}.c:hover~.def{display:none}.def{pointer-events:none}` +
      `.x{stroke:${th.cross};stroke-dasharray:3 3}.hit{fill:transparent}.u{fill:${up};stroke:${up}}.d{fill:${down};stroke:${down}}` +
      `.ln{fill:none;stroke-width:1.5;stroke-linejoin:round}</style>`,
  )
  out.push(`<clipPath id="pp"><rect x="0" y="${pTop}" width="${plotRight}" height="${PRICE_H}"/></clipPath>`)
  out.push(`<rect width="${W}" height="${H}" rx="8" fill="${th.panel}"/>`)

  // Grid: round prices across, round times down.
  const ticks = niceTicks(lo, hi, 5)
  const tickStep = ticks.length > 1 ? (ticks[1] as number) - (ticks[0] as number) : Math.abs(hi - lo) || 1
  for (const p of ticks) {
    const y = f1(Y(p))
    out.push(`<line class="g" x1="0" x2="${plotRight}" y1="${y}" y2="${y}"/><text class="t" x="${plotRight + 6}" y="${f1(Y(p) + 4)}">${esc(fmtTick(p, tickStep))}</text>`)
  }
  const tt = timeTicks(candles)
  for (const { i, isDay } of tt) {
    const x = f1(X(i))
    const c = candles[i] as Candle
    out.push(`<line class="g" x1="${x}" x2="${x}" y1="${pTop}" y2="${bottom}" stroke-opacity=".6"/>`)
    out.push(`<text class="${isDay ? 'b' : 't'}" x="${x}" y="${H - 7}" text-anchor="middle">${esc(tickLabel(c.t, interval, isDay))}</text>`)
  }
  out.push(`<line class="g" x1="${plotRight}" x2="${plotRight}" y1="0" y2="${bottom}"/><line class="g" x1="0" x2="${W}" y1="${bottom}" y2="${bottom}"/>`)

  // Volume along the bottom of the price pane.
  let vmax = 0
  for (const c of candles) vmax = Math.max(vmax, c.v)
  if (vmax > 0) {
    const vh = PRICE_H * 0.16
    const ups: string[] = []
    const downs: string[] = []
    candles.forEach((c, i) => {
      const h = (c.v / vmax) * vh
      if (h < 0.3) return
      ;(c.c >= c.o ? ups : downs).push(`M${f1(X(i) - BODY / 2)} ${f1(pBot - h)}h${BODY}v${f1(h)}h-${BODY}Z`)
    })
    out.push(`<path d="${ups.join('')}" fill="${up}" fill-opacity=".22"/><path d="${downs.join('')}" fill="${down}" fill-opacity=".22"/>`)
  }

  // Zones behind everything else in the price pane.
  const marks = input.marks ?? []
  const isLight = input.theme === 'light'
  // Marks stop where the DaviddTech+ range starts.
  const markEnd = hasFan ? plotW : plotRight
  // Price tags for levels go on the scale, outside the price pane's clip.
  const tags: string[] = []
  out.push('<g clip-path="url(#pp)">')
  // Layer spans: a soft band across the price pane from the first candle to the last, its label at the top.
  for (const m of marks) if (m.kind === 'span' && m.t !== undefined && m.t2 !== undefined) {
    const i1 = candles.findIndex(c => c.t === m.t)
    const i2 = candles.findIndex(c => c.t === m.t2)
    if (i1 < 0 || i2 < 0) continue
    const x1 = X(i1) - PITCH / 2
    const x2 = X(i2) + PITCH / 2
    const sc = m.ink ?? inks[2]
    out.push(`<rect x="${f1(x1)}" y="${pTop}" width="${f1(Math.max(1, x2 - x1))}" height="${f1(pBot - pTop)}" fill="${sc}" fill-opacity="${isLight ? '.07' : '.09'}"/>`)
    if (m.label) out.push(`<text class="t" x="${f1(x1 + 4)}" y="${f1(pBot - 6)}" fill="${sc}" font-size="10">${esc(m.label)}</text>`)
  }
  for (const m of marks) if (m.kind === 'zone') {
    const y1 = Y(m.price2 ?? m.price)
    const y2 = Y(m.price)
    const zc = inks[1]
    out.push(`<rect x="0" y="${f1(y1)}" width="${markEnd}" height="${f1(Math.max(1, y2 - y1))}" fill="${zc}" fill-opacity="${isLight ? '.08' : '.1'}"/>`)
    out.push(`<path d="M0 ${f1(y1)}H${markEnd}M0 ${f1(y2)}H${markEnd}" stroke="${zc}" stroke-opacity=".35"/>`)
    out.push(`<text class="b" x="6" y="${f1(y1 + 12)}" fill-opacity=".85">${esc(`${m.label ? m.label + ' ' : ''}${fmtMark(m.price)}–${fmtMark(m.price2 ?? m.price)}`)}</text>`)
  }
  out.push('</g>')

  // Price studies under the candles, clipped to the price pane. Two stacked fills turn muddy: a band wins.
  const hasBand = shownPrices.some(s => s.fill)
  out.push('<g clip-path="url(#pp)">')
  for (const s of shownPrices) {
    const col = ink(s)
    if (s.kind === 'supertrend') {
      const line = s.series[0]?.values ?? []
      const side = s.side ?? []
      for (const want of [1, -1] as const) {
        const vals = line.map((v, i) => (side[i] === want ? v : null))
        const closes = candles.map((c, i) => (side[i] === want ? c.c : null))
        const color = want === 1 ? inks[4] : inks[5]
        if (!hasBand) out.push(`<path d="${areaOf(vals, closes, X, Y)}" fill="${color}" fill-opacity=".06"/>`)
        out.push(`<path class="ln" d="${pathOf(vals, X, Y)}" stroke="${color}" stroke-width="2"/>`)
      }
      continue
    }
    if (s.fill) {
      const [a, b] = s.fill
      out.push(`<path d="${areaOf(s.series[a]?.values ?? [], s.series[b]?.values ?? [], X, Y)}" fill="${col}" fill-opacity="${isLight ? '.06' : '.08'}"/>`)
    }
    const dayBreak = s.kind === 'vwap' ? (i: number) => Math.floor((candles[i] as Candle).t / 86_400_000) !== Math.floor(((candles[i - 1] ?? candles[i]) as Candle).t / 86_400_000) : undefined
    s.series.forEach(se => {
      const isBasis = se.style === 'dash'
      const dash = isBasis ? ' stroke-dasharray="2 3" stroke-opacity=".7"' : isDashed(s) ? ' stroke-dasharray="5 3"' : ''
      const width = s.fill && !isBasis ? ' stroke-width="1"' : ''
      out.push(`<path class="ln" d="${pathOf(se.values, X, Y, dayBreak)}" stroke="${col}"${dash}${width}/>`)
    })
  }
  out.push('</g>')

  // The DaviddTech+ range to the right of the last candle, joined to it by a dot.
  if (input.fan && last && fanW > 0) {
    const fx = plotW
    const k = 24
    const pts = Array.from({ length: k + 1 }, (_, i) => fanAt(input.fan as Fan, last.c, i / k))
    const FX = (t: number) => f1(fx + t * (fanW - 6))
    const area = (a: 'p10' | 'p25', b: 'p90' | 'p75') =>
      pts.map(p => `${FX(p.x)},${f1(Y(p[b]))}`).join(' ') + ' ' + [...pts].reverse().map(p => `${FX(p.x)},${f1(Y(p[a]))}`).join(' ')
    out.push(`<line class="g" x1="${fx}" x2="${fx}" y1="${pTop}" y2="${pBot}"/>`)
    out.push(`<polygon points="${area('p10', 'p90')}" fill="${fanInk}" fill-opacity=".18"><title>80% range</title></polygon>`)
    out.push(`<polygon points="${area('p25', 'p75')}" fill="${fanInk}" fill-opacity=".34"><title>50% range</title></polygon>`)
    out.push(`<polyline points="${pts.map(p => `${FX(p.x)},${f1(Y(p.p50))}`).join(' ')}" fill="none" stroke="${fanInk}" stroke-opacity=".7"><title>middle path</title></polyline>`)
    out.push(`<circle cx="${f1(X(candles.length - 1))}" cy="${f1(Y(last.c))}" r="5" fill="${fanInk}" fill-opacity=".25"/><circle cx="${f1(X(candles.length - 1))}" cy="${f1(Y(last.c))}" r="2.5" fill="${fanInk}"/>`)
    // The whole label, smaller when the zone is narrow; just the horizon when even that does not fit.
    const fanText = fanLabel ? `DaviddTech+ · ${fanLabel}` : 'DaviddTech+ range'
    const room = fanW - 8
    const [txt, size] = fanText.length * CH <= room ? [fanText, ''] : fanText.length * 6 <= room ? [fanText, ' font-size="10"'] : [(fanLabel ?? fanText).slice(0, Math.floor(room / 6)), ' font-size="10"']
    out.push(`<text class="t" x="${fx + 5}" y="${pTop + 12}"${size}>${esc(txt)}</text>`)
  }

  // Paths ahead (moments like now): what came after each look-alike, thin, and their middle in the layer's ink.
  if (ghost && fanW > 0) {
    const anchor = input.candles[ghost.anchor] as Candle
    const ai = ghost.anchor - (input.candles.length - candles.length)
    const x0 = X(ai)
    const step = Math.max(1, Math.min(PITCH, (plotW + fanW - 8 - x0) / Math.max(1, ghost.median.length)))
    const pts = (p: readonly number[]) => [`${f1(x0)},${f1(Y(anchor.c))}`, ...p.map((v, s) => `${f1(x0 + (s + 1) * step)},${f1(Y(anchor.c * (1 + v)))}`)].join(' ')
    const ink = hex(ghost.ink)
    out.push(`<line class="g" x1="${plotW}" x2="${plotW}" y1="${pTop}" y2="${pBot}"/>`)
    out.push(`<g fill="none" stroke="${ink}" stroke-opacity=".3" stroke-width="1">${ghost.paths.map(p => `<polyline points="${pts(p)}"/>`).join('')}</g>`)
    out.push(`<polyline points="${pts(ghost.median)}" fill="none" stroke="${ink}" stroke-width="2" stroke-linejoin="round"><title>${esc(`middle of ${ghost.label}`)}</title></polyline>`)
    out.push(`<circle cx="${f1(x0)}" cy="${f1(Y(anchor.c))}" r="2.5" fill="${ink}"/>`)
    const room = fanW - 8
    const txt = ghost.label.length * 6 <= room ? ghost.label : 'look-alikes'.length * 6 <= room ? 'look-alikes' : ''
    // Just over the highest path, so the name sits on what it names.
    // When the paths reach the top of the plot, the name goes under the lowest one instead.
    const all = [...ghost.median, ...ghost.paths.flat()]
    const above = Y(anchor.c * (1 + Math.max(...all))) - 6
    const ty = above >= pTop + 12 ? above : Math.min(pBot - 4, Y(anchor.c * (1 + Math.min(...all))) + 14)
    if (txt) out.push(`<text class="t" x="${plotW + 5}" y="${f1(ty)}" font-size="10">${esc(txt)}</text>`)
  }

  // Candles: filled both ways (hollow up candles on the colorblind palette, a second cue beside the hue).
  const bodies = { u: [] as string[], d: [] as string[], uh: [] as string[] }
  const wicks = { u: [] as string[], d: [] as string[] }
  candles.forEach((c, i) => {
    const isUp = c.c >= c.o
    const x = X(i)
    const yt = Y(Math.max(c.o, c.c))
    const yb = Y(Math.min(c.o, c.c))
    wicks[isUp ? 'u' : 'd'].push(`M${f1(x)} ${f1(Y(c.h))}V${f1(Y(c.l))}`)
    const h = Math.max(1, yb - yt)
    const rect = `M${f1(x - BODY / 2)} ${f1(yt)}h${BODY}v${f1(h)}h-${BODY}Z`
    if (isUp && isCb && h > 3) bodies.uh.push(`M${f1(x - BODY / 2 + 0.75)} ${f1(yt + 0.75)}h${BODY - 1.5}v${f1(h - 1.5)}h-${BODY - 1.5}Z`)
    else bodies[isUp ? 'u' : 'd'].push(rect)
  })
  out.push(`<path d="${wicks.u.join('')}" stroke="${up}" fill="none"/><path d="${wicks.d.join('')}" stroke="${down}" fill="none"/>`)
  out.push(`<path d="${bodies.u.join('')}" fill="${up}"/><path d="${bodies.d.join('')}" fill="${down}"/>`)
  if (bodies.uh.length > 0) out.push(`<path d="${bodies.uh.join('')}" fill="${th.panel}" stroke="${up}" stroke-width="1.5"/>`)

  // Levels across the chart with their price on the scale, and notes above their candle.
  out.push('<g clip-path="url(#pp)">')
  // Mark labels sit on the left edge; one that would cover the legend or another label moves to the right end.
  const taken: { x: number; y0: number; y1: number }[] = []
  const labelX = (top: number, h: number, w: number): number => {
    const right = Math.max(4, markEnd - w - 4)
    const free = (x: number) => !taken.some(t => Math.abs(t.x - x) < 40 && top < t.y1 + 1 && top + h > t.y0 - 1)
    const x = top >= legendBottom && free(4) ? 4 : free(right) ? right : 4
    taken.push({ x, y0: top, y1: top + h })
    return x
  }
  for (const m of marks) {
    if (m.kind === 'level') {
      const y = Y(m.price)
      out.push(`<line x1="0" x2="${markEnd}" y1="${f1(y)}" y2="${f1(y)}" stroke="${th.bright}" stroke-opacity=".45" stroke-dasharray="6 4"/>`)
      if (m.label) {
        const w = m.label.length * CH + 8
        const lx = labelX(y - 15, 13, w)
        out.push(`<rect class="k" x="${f1(lx)}" y="${f1(y - 15)}" width="${f1(w)}" height="13" rx="2"/><text class="b" x="${f1(lx + 4)}" y="${f1(y - 5)}" fill-opacity=".9">${esc(m.label)}</text>`)
      }
      if (y > pTop + 9 && y < pBot - 9)
        tags.push(`<rect x="${plotRight + 1}" y="${f1(y - 9)}" width="${SCALE - 3}" height="18" rx="3" fill="${th.bright}"/><text x="${plotRight + 6}" y="${f1(y + 4)}" fill="${th.panel}">${esc(fmtMark(m.price))}</text>`)
    } else if (m.kind === 'trend' && m.t !== undefined && m.t2 !== undefined && m.price2 !== undefined && candles.length > 1) {
      // A ray through two candles, extended right like TradingView's trend line; points placed by time.
      const first = candles[0] as Candle
      const step = (candles[1] as Candle).t - first.t || 1
      const xt = (t: number) => X(0) + ((t - first.t) / step) * PITCH
      const x1 = xt(m.t)
      const x2 = xt(m.t2)
      if (x2 === x1) continue
      const y1 = Y(m.price)
      const y2 = Y(m.price2)
      const yEnd = y1 + ((y2 - y1) * (markEnd - x1)) / (x2 - x1)
      out.push(`<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(markEnd)}" y2="${f1(yEnd)}" stroke="${th.bright}" stroke-opacity=".8" stroke-width="1.5"/>`)
      out.push(`<circle cx="${f1(x1)}" cy="${f1(y1)}" r="2.5" fill="${th.bright}"/><circle cx="${f1(x2)}" cy="${f1(y2)}" r="2.5" fill="${th.bright}"/>`)
      if (m.label) out.push(`<text class="b" x="${f1(x2 + 6)}" y="${f1(y2 + (y2 > y1 ? 14 : -6))}" fill-opacity=".85">${esc(m.label)}</text>`)
    } else if (m.kind === 'fib') {
      // TradingView's retracement levels across the chart, the 0.5-0.618 band tinted, each level named on the left.
      const lv = fibPrices(m)
      const gold = inks[0]
      const a = lv.find(x => x.r === 0.5)
      const b = lv.find(x => x.r === 0.618)
      if (a && b) out.push(`<rect x="0" y="${f1(Math.min(Y(a.price), Y(b.price)))}" width="${markEnd}" height="${f1(Math.abs(Y(a.price) - Y(b.price)))}" fill="${gold}" fill-opacity=".1"/>`)
      for (const x of lv) {
        const y = Y(x.price)
        if (y < pTop || y > pBot) continue
        const isEdge = x.r === 0 || x.r === 1
        out.push(`<line x1="0" x2="${markEnd}" y1="${f1(y)}" y2="${f1(y)}" stroke="${gold}" stroke-opacity="${isEdge ? '.7' : '.5'}"${isEdge ? '' : ' stroke-dasharray="3 3"'}/>`)
        // Above its line on the left; on the right end where the legend sits. A soft backing keeps it readable.
        const text = `${x.r} (${fmtPrice(x.price)})`
        const ty = y - 13 < pTop ? y + 12 : y - 4
        const w = text.length * 6 + 6
        const lx = labelX(ty - 9, 12, w)
        out.push(`<rect class="k" x="${f1(lx)}" y="${f1(ty - 9)}" width="${f1(w)}" height="12" rx="2"/><text class="t" x="${f1(lx + 3)}" y="${f1(ty)}" font-size="10">${esc(text)}</text>`)
      }
    } else if (m.kind === 'pin' && m.t !== undefined) {
      // A layer pin: an arrow under the candle pointing up, over it pointing down, or a dot at its price.
      const i = candles.findIndex(c => c.t === m.t)
      if (i < 0) continue
      const c = candles[i] as Candle
      const x = X(i)
      const pc = m.ink ?? th.bright
      let ly: number
      if (m.dir === 'up') {
        const y = Y(c.l) + 5
        out.push(`<path d="M${f1(x)} ${f1(y)}l4 6h-8Z" fill="${pc}"/>`)
        ly = y + 16
      } else if (m.dir === 'down') {
        const y = Y(c.h) - 5
        out.push(`<path d="M${f1(x)} ${f1(y)}l4 -6h-8Z" fill="${pc}"/>`)
        ly = y - 9
      } else {
        const y = Y(m.price)
        out.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="3" fill="${pc}" stroke="${th.panel}" stroke-width="1"/>`)
        ly = y - 7
      }
      if (m.label) out.push(`<text class="t" x="${f1(x)}" y="${f1(ly)}" fill="${pc}" font-size="10" text-anchor="middle">${esc(m.label)}</text>`)
    } else if (m.kind === 'note' && m.t !== undefined) {
      const i = candles.findIndex(c => c.t === m.t)
      if (i < 0) continue
      const c = candles[i] as Candle
      const x = X(i)
      const y = Y(c.h) - 6
      out.push(`<path d="M${f1(x - 4)} ${f1(y - 7)}h8l-4 6Z" fill="${th.bright}"/>`)
      const w = m.label.length * CH + 8
      const lx = Math.max(2, Math.min(plotW - w - 2, x - w / 2))
      out.push(`<rect x="${f1(lx)}" y="${f1(y - 24)}" width="${f1(w)}" height="15" rx="3" fill="${th.bright}"/><text x="${f1(lx + 4)}" y="${f1(y - 13)}" fill="${th.panel}">${esc(m.label)}</text>`)
    }
  }
  out.push('</g>')
  out.push(...tags)

  // Last price: a dotted line and its tag on the scale, the interval under it.
  if (last) {
    const y = Y(last.c)
    const col = last.c >= last.o ? up : down
    const txt = hex(last.c >= last.o ? pal.upText : pal.downText)
    out.push(`<line x1="0" x2="${plotRight}" y1="${f1(y)}" y2="${f1(y)}" stroke="${col}" stroke-opacity=".8" stroke-dasharray="1 3"/>`)
    out.push(`<rect x="${plotRight + 1}" y="${f1(y - 9)}" width="${SCALE - 3}" height="18" rx="3" fill="${col}"/><text x="${plotRight + 6}" y="${f1(y + 4)}" fill="${txt}">${esc(fmtPrice(last.c))}</text>`)
  }

  // Lower panes.
  const panes = shownLowers.map((s, k) => lowerPane(s, pBot + LOWER_H * k))
  for (const p of panes) {
    const s = p.study
    const col = ink(s)
    out.push(`<line class="g" x1="0" x2="${W}" y1="${p.y0}" y2="${p.y0}"/>`)
    for (const l of p.labels) out.push(`<text class="t" x="${plotRight + 6}" y="${f1(p.Y(l.v) + 4)}">${esc(l.text)}</text>`)
    const levels = s.scale && Number.isFinite(s.scale.min) ? [...s.scale.levels].sort((a, b) => a - b) : []
    if (levels.length >= 2) {
      // The band between the outer levels (RSI 30-70, Stoch 20-80), dashed edges, a dotted middle.
      const top = levels[levels.length - 1] as number
      const bot = levels[0] as number
      out.push(`<rect x="0" y="${f1(p.Y(top))}" width="${plotRight}" height="${f1(p.Y(bot) - p.Y(top))}" fill="${col}" fill-opacity=".06"/>`)
      for (const v of levels) {
        const isEdge = v === top || v === bot
        out.push(`<line x1="0" x2="${plotRight}" y1="${f1(p.Y(v))}" y2="${f1(p.Y(v))}" stroke="${th.text}" stroke-opacity="${isEdge ? '.5' : '.35'}" stroke-dasharray="${isEdge ? '4 3' : '1 3'}"/>`)
      }
    }
    if (!(s.scale && Number.isFinite(s.scale.min)) && s.kind !== 'macd')
      for (const v of s.scale?.levels ?? []) if (v > p.lo && v < p.hi) out.push(`<line x1="0" x2="${plotRight}" y1="${f1(p.Y(v))}" y2="${f1(p.Y(v))}" stroke="${th.text}" stroke-opacity=".35" stroke-dasharray="1 3"/>`)
    if (s.kind === 'macd') out.push(`<line x1="0" x2="${plotRight}" y1="${f1(p.Y(0))}" y2="${f1(p.Y(0))}" stroke="${th.text}" stroke-opacity=".4"/>`)
    s.series.forEach((se, si) => {
      if (se.style === 'hist') {
        const parts: Record<string, string[]> = { ua: [], ub: [], da: [], db: [] }
        se.values.forEach((v, i) => {
          if (v === null || v === undefined) return
          const prev = se.values[i - 1]
          const isGrowing = prev === null || prev === undefined ? true : v >= 0 ? v >= prev : v <= prev
          const y0 = p.Y(0)
          const y1 = p.Y(v)
          const key = (v >= 0 ? 'u' : 'd') + (isGrowing ? 'a' : 'b')
          parts[key]?.push(`M${f1(X(i) - BODY / 2)} ${f1(Math.min(y0, y1))}h${BODY}v${f1(Math.max(0.5, Math.abs(y1 - y0)))}h-${BODY}Z`)
        })
        out.push(`<path d="${parts.ua?.join('')}" fill="${up}" fill-opacity=".75"/><path d="${parts.ub?.join('')}" fill="${up}" fill-opacity=".35"/>`)
        out.push(`<path d="${parts.da?.join('')}" fill="${down}" fill-opacity=".75"/><path d="${parts.db?.join('')}" fill="${down}" fill-opacity=".35"/>`)
        return
      }
      // A second line keeps apart: +DI / -DI in the candle colors, MACD avg and %D in another ink, dashed.
      const stroke = seriesInk(s, se)
      const isDi = se.tone === 'up' || se.tone === 'down'
      const isMainOfDi = !se.tone && hasDi(s)
      const extra = se.tone === 'alt' ? ' stroke-dasharray="4 3"' : isDi ? ' stroke-width="1" stroke-opacity=".7"' : isMainOfDi ? ' stroke-width="1.5"' : ''
      out.push(`<path class="ln" d="${pathOf(se.values, X, p.Y)}" stroke="${stroke}"${extra}/>`)
    })
  }

  // The legend: what each row says never moves; the values follow the hovered candle, else the cursor.
  const rowsY = (k: number) => 16 + 14 * k
  const studyRows = shownPrices.map((s, k) => ({ s, y: rowsY(k + 1), x: 6 }))
  const paneRows = panes.map(p => ({ s: p.study, y: p.y0 + 13, x: 6 }))
  const labelW = (s: Study) => (s.label.length + 1) * CH + 14
  for (const r of [...studyRows, ...paneRows]) {
    const col = r.s.kind === 'supertrend' ? inks[4] : mainInk(r.s)
    out.push(`<rect class="k" x="${r.x - 2}" y="${r.y - 10}" width="${f1(labelW(r.s) + 24 * CH)}" height="13" rx="2"/>`)
    out.push(`<rect x="${r.x}" y="${r.y - 8}" width="8" height="8" rx="1.5" fill="${col}"/><text class="t" x="${r.x + 12}" y="${r.y}">${esc(r.s.label)}</text>`)
  }
  const headX = 6
  const head = `${coin} · ${interval}`
  out.push(`<rect class="k" x="${headX - 2}" y="${rowsY(0) - 10}" width="${f1((head.length + 52) * CH)}" height="13" rx="2"/>`)
  out.push(`<text class="b" x="${headX}" y="${rowsY(0)}" font-weight="600">${esc(head)}</text>`)
  const ohlcX = headX + (head.length + 2) * CH
  const legendAt = (i: number, withValues: boolean): string => {
    const c = candles[i]
    if (!c) return ''
    const ch = c.o === 0 ? null : ((c.c - c.o) / c.o) * 100
    const col = c.c >= c.o ? up : down
    let g = `<text x="${f1(ohlcX)}" y="${rowsY(0)}" class="t">O <tspan fill="${col}">${esc(fmtPrice(c.o))}</tspan> H <tspan fill="${col}">${esc(fmtPrice(c.h))}</tspan> L <tspan fill="${col}">${esc(fmtPrice(c.l))}</tspan> C <tspan fill="${col}">${esc(fmtPrice(c.c))}</tspan> <tspan fill="${col}">${esc(fmtPct(ch))}</tspan></text>`
    if (withValues) {
      for (const r of [...studyRows, ...paneRows]) {
        g += `<text x="${f1(r.x + labelW(r.s))}" y="${r.y}">${legendSpans(r.s, i)}</text>`
      }
    }
    return g
  }
  const crossAt = (i: number): string => {
    const x = f1(X(i))
    const c = candles[i] as Candle
    const t = fmtTime(c.t, interval)
    const w = t.length * CH + 10
    return (
      `<line class="x" x1="${x}" x2="${x}" y1="${pTop}" y2="${bottom}"/>` +
      `<rect x="${f1(Math.max(0, Math.min(plotRight - w, X(i) - w / 2)))}" y="${bottom + 2}" width="${f1(w)}" height="17" rx="3" fill="${th.bright}"/>` +
      `<text x="${f1(Math.max(w / 2, Math.min(plotRight - w / 2, X(i))))}" y="${bottom + 14}" text-anchor="middle" fill="${th.panel}">${esc(t)}</text>`
    )
  }

  // Hover: one group per candle, siblings, then the default legend, which a hovered group hides.
  const cursorI = candles.length - 1 - Math.max(0, Math.min(input.cursor, candles.length - 1))
  if (detail !== 'no-hover') {
    candles.forEach((_, i) => {
      out.push(`<g class="c"><rect class="hit" x="${f1(X(i) - PITCH / 2)}" y="${pTop}" width="${PITCH}" height="${bottom - pTop}"/><g class="h">${crossAt(i)}${legendAt(i, detail === 'full')}</g></g>`)
    })
  }
  out.push(`<g class="def">${input.cursor > 0 ? crossAt(cursorI) : ''}${legendAt(cursorI, true)}</g>`)
  out.push('</svg>')
  return out.join('')
}

/** What the chart says, for a reader that cannot see it. */
export function deskAlt(coin: string, interval: string, candles: readonly Candle[], hasFan: boolean, studies: readonly Study[]): string {
  const last = candles[candles.length - 1]
  const first = candles[0]
  if (!last || !first) return `${coin} ${interval} chart, no candles yet`
  // Over the last 24 hours: the chart holds more candles than it shows.
  const dayAgo = candles.find(c => c.t >= last.t - 86_400_000) ?? first
  const change = dayAgo.o === 0 ? null : ((last.c - dayAgo.o) / dayAgo.o) * 100
  const ind = studies.length > 0 ? `, with ${studies.map(s => s.label).join(', ')}` : ''
  return `${coin} ${interval} candle chart, last ${fmtPrice(last.c)}, ${fmtPct(change)} over 24 hours${ind}${hasFan ? ', and the DaviddTech+ forecast range' : ''}`
}

/** The share card's size: 16:9, the size Skool and X show a picture at. */
export const CARD_W = 1200
export const CARD_H = 675

/**
 * A card to post: the chart as drawn (`chart`, from deskSvg) under a header with the coin, interval, last price and
 * the change over 24 hours, and a footer with where it was made. Same theme as the chart.
 */
export function shareCard(chart: string, candles: readonly Candle[], coin: string, interval: string, at: string, theme: Theme = 'dark', palette: Palette = PALETTES.classic): string {
  const t = THEMES[theme]
  const last = candles[candles.length - 1]
  // The change over the last 24 hours (the chart holds more candles than it shows).
  const dayAgo = last ? candles.find(c => c.t >= last.t - 86_400_000) : undefined
  const change = dayAgo && last && dayAgo.o !== 0 ? ((last.c - dayAgo.o) / dayAgo.o) * 100 : null
  const ink = change === null ? t.text : hex(change >= 0 ? palette.up : palette.down)
  const sans = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
  // The chart keeps its own drawing; only its outer tag changes, so it sits in the card's middle box at any height.
  const h = Number(/height="(\d+(?:\.\d+)?)"/.exec(chart)?.[1] ?? svgHeight(0))
  const top = 84
  const bottom = 48
  const inner = chart.replace(/^<svg [^>]*>/, m =>
    m.replace(/ width="[^"]*"/, '').replace(/ height="[^"]*"/, '').replace('<svg ', `<svg x="24" y="${top}" width="${CARD_W - 48}" height="${CARD_H - top - bottom}" preserveAspectRatio="xMidYMid meet" `),
  )
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}" font-family="${sans}">`,
    `<rect width="${CARD_W}" height="${CARD_H}" fill="${t.panel}"/>`,
    `<rect x="0" y="0" width="${CARD_W}" height="4" fill="${hex(palette.fan)}"/>`,
    `<text x="32" y="50" font-size="30" font-weight="700" fill="${t.bright}">${esc(coin)}<tspan font-weight="400" fill="${t.text}"> · ${esc(interval)}</tspan></text>`,
    last ? `<text x="${CARD_W - 32}" y="50" text-anchor="end" font-size="30" font-weight="700" fill="${t.bright}">${esc(fmtPrice(last.c))}${change === null ? '' : `<tspan font-size="20" font-weight="400" fill="${ink}"> ${esc(fmtPct(change))} 24h</tspan>`}</text>` : '',
    inner,
    `<text x="32" y="${CARD_H - 18}" font-size="15" font-weight="700" fill="${t.bright}">DaviddTech Lab<tspan font-weight="400" fill="${t.text}"> · charted in Claude Code</tspan></text>`,
    `<text x="${CARD_W - 32}" y="${CARD_H - 18}" text-anchor="end" font-size="15" fill="${t.text}">${esc(at)} UTC · davidd.link/daviddtechplus</text>`,
    '</svg>',
  ]
  return out.filter(x => x !== '').join('\n')
}
