// Drawing the chart: a terminal Raster (cells of block and box glyphs) and an
// SVG for the desktop, editor and phone. Pure: no `$`.

import type { Candle, Fan } from '../types'
import { fmtPct, fmtPrice, fmtTime } from './data'
import { fanAt, fanRange } from './forecast'
import { compareStudy } from './indicators'

/**
 * The chart colors. A mod cannot tell a light terminal from a dark one, so each
 * color reads on both (at least about 3:1 on white and on #1e1e1e). The fan ink
 * sits between the two candle colors in brightness, so the weights keep their
 * order on either theme. `upText` / `downText` are the last-price tag's text.
 */
export type Palette = { up: number; down: number; upText: number; downText: number; fan: number }
export type PaletteName = 'classic' | 'colorblind'
export const PALETTES: Readonly<Record<PaletteName, Palette>> = {
  // Teal and red, as trading screens use.
  classic: { up: 0x26a69a, down: 0xef5350, upText: 0xffffff, downText: 0xffffff, fan: 0x4c8bf5 },
  // Blue and a darker orange: apart for red-green color blindness and in grayscale.
  colorblind: { up: 0x0072b2, down: 0xd68000, upText: 0xffffff, downText: 0x14171c, fan: 0x77808c },
}
export const UP = PALETTES.classic.up
export const DOWN = PALETTES.classic.down
export const DEFAULT = 0x01000000
const GRID = 0x5f6670
export const LABEL = 0x77808c
const CURSOR_BG = 0x2a2f36
/** The fan's glyphs, weakest to strongest: 80% range, 50% range, middle. One ink, default background. */
export const FAN_GLYPHS = { range80: 0x2591, range50: 0x2592, middle: 0x2500 } as const
/** Below this many columns the terminal chart is a braille line of closes, not candles. */
export const LINE_BELOW = 40

/** The smallest chart worth drawing; below it the pane shows the readout alone. */
export const MIN_COLUMNS = 20
export const MIN_ROWS = 4

/** The Raster's size for a pane body: its width, its height less the text lines around it. */
/** How many rows a wrapping row of terminal buttons takes: each is drawn as "[ label ]", one column apart. */
export function buttonRows(labels: readonly string[], columns: number, tail = 0): number {
  let rows = 1
  let x = 0
  for (const w of [...labels.map(l => l.length + 4), ...(tail > 0 ? [tail] : [])]) {
    if (x > 0 && x + 1 + w > columns) {
      rows += 1
      x = w
    } else x += (x > 0 ? 1 : 0) + w
  }
  return rows
}

/** How many rows a wrapped line of text takes. */
export function textRows(text: string, columns: number): number {
  return Math.max(1, Math.ceil(text.length / Math.max(1, columns)))
}

export function chartSize(bodyColumns: number, bodyRows: number, linesAround: number): { columns: number; rows: number } | null {
  const columns = Math.min(512, Math.floor(bodyColumns))
  const rows = Math.min(256, Math.max(0, Math.floor(bodyRows) - linesAround), 40)
  if (columns < MIN_COLUMNS || rows < MIN_ROWS) return null
  return { columns, rows }
}

/**
 * Paths drawn to the right of candle `anchor` (an index into the candles), each a move from its close per candle
 * after it, as fractions; `median` the middle one, drawn strongest. Used only when no DaviddTech+ fan shows.
 */
export type Ghost = { anchor: number; paths: number[][]; median: number[]; ink: number; label: string }

/** The lowest and highest prices the paths reach, from the anchor's close. */
export function ghostRange(g: Ghost, candles: readonly Candle[]): [number, number] | null {
  const a = candles[g.anchor]
  if (!a) return null
  let lo = a.c
  let hi = a.c
  for (const p of [...g.paths, g.median]) for (const v of p) {
    lo = Math.min(lo, a.c * (1 + v))
    hi = Math.max(hi, a.c * (1 + v))
  }
  return [lo, hi]
}

export type ChartInput = {
  ghost?: Ghost | null
  candles: readonly Candle[]
  /** Candles back from the last one that the cursor marks; 0 is the last. */
  cursor: number
  fan: Fan | null
  /** The colors; classic when absent. */
  palette?: Palette
  /** Another coin's candles for the Compare line (same interval). */
  compare?: { coin: string; candles: readonly Candle[]; from: number } | null
}

export type Layout = {
  axis: number
  fan: number
  plot: number
  shown: Candle[]
  lo: number
  hi: number
}

/** How the width splits: candles, then the forecast zone, then the price axis. */
/** The price axis's width: none under 30 columns. */
function axisWidth(columns: number, lastPrice: number): number {
  return columns >= 30 ? Math.min(12, Math.max(7, fmtPrice(lastPrice).length + 2)) : 0
}

export function layoutFor(input: ChartInput, columns: number): Layout {
  const last = input.candles[input.candles.length - 1]
  const lastPrice = last?.c ?? 0
  const axis = axisWidth(columns, lastPrice)
  const rest = columns - axis
  const ghost = !input.fan && input.ghost && rest >= 30 ? input.ghost : null
  // The paths ahead take one column a candle, as the candles do, past the last one.
  const ahead = ghost ? ghost.median.length - (input.candles.length - 1 - ghost.anchor) : 0
  const fan = input.fan && rest >= 30 ? Math.max(6, Math.min(40, Math.round(rest * 0.25))) : ghost && ahead > 0 ? Math.min(Math.round(rest * 0.3), ahead + 2) : 0
  const plot = Math.max(1, rest - fan)
  const shown = input.candles.slice(-plot)
  let lo = Infinity
  let hi = -Infinity
  for (const c of shown) {
    lo = Math.min(lo, c.l)
    hi = Math.max(hi, c.h)
  }
  if (input.fan && fan > 0 && last) {
    const [flo, fhi] = fanRange(input.fan, last.c)
    lo = Math.min(lo, flo)
    hi = Math.max(hi, fhi)
  }
  const gr = ghost && fan > 0 ? ghostRange(ghost, input.candles) : null
  if (gr) {
    lo = Math.min(lo, gr[0])
    hi = Math.max(hi, gr[1])
  }
  // The Compare line counts in the scale, as on the desktop chart.
  const cmp = input.compare ? compareStudy(input.compare.coin, input.candles, input.compare.candles, input.compare.from) : null
  for (const v of (cmp?.series[0]?.values ?? []).slice(-shown.length)) {
    if (v === null || !Number.isFinite(v)) continue
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0
    hi = 1
  }
  if (hi - lo < Math.abs(hi) * 1e-6 || hi === lo) {
    const pad = Math.abs(hi) * 0.001 || 1
    lo -= pad
    hi += pad
  }
  const pad = (hi - lo) * 0.03
  return { axis, fan, plot, shown, lo: lo - pad, hi: hi + pad }
}

type Cell = [number, number, number]

/** The price axis on the right: evenly spaced prices (five on a tall chart), and the last price in a tag of the candle's color. */
/** About `count` round price levels between lo and hi (steps of 1, 2, 2.5 or 5 times a power of ten). */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo
  if (!(span > 0)) return [lo]
  const raw = span / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find(m => m * pow >= raw) ?? 10) * pow
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)))
  return out
}

/** A round price level with just the decimals its step needs: "64,000", "75", "0.0125". */
export function fmtTick(v: number, step: number): string {
  let d = 0
  while (d < 8 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-6) d++
  const [int, frac] = Math.abs(v).toFixed(d).split('.')
  const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (v < 0 ? '-' : '') + grouped + (frac ? '.' + frac : '')
}

function drawAxis(
  set: (x: number, y: number, cell: Cell) => void,
  columns: number,
  rows: number,
  axis: number,
  priceAt: (y: number) => number,
  last: Candle | undefined,
  tagRow: number,
  pal: Palette,
): void {
  if (axis <= 0) return
  const ax = columns - axis
  const write = (y: number, text: string, fg: number, bg: number) => {
    const t = text.slice(0, axis - 1)
    set(ax, y, [0x2524, GRID, DEFAULT])
    for (let k = 0; k < t.length; k++) set(ax + 1 + k, y, [t.charCodeAt(k), fg, bg])
  }
  for (let y = 0; y < rows; y++) set(ax, y, [0x2502, GRID, DEFAULT])
  const end = rows - 1
  const tag = Math.max(0, Math.min(end, tagRow))
  // Round price levels, as on the desktop chart, each on the row that holds it; none touching another or the
  // last-price tag, so every label reads on its own.
  const top = priceAt(0)
  const perRow = end > 0 ? top - priceAt(1) : 0
  const ticks = perRow > 0 ? niceTicks(priceAt(end), top, rows >= 14 ? 5 : rows >= 6 ? 3 : 2) : []
  const step = ticks.length > 1 ? (ticks[1] as number) - (ticks[0] as number) : 0
  const used: number[] = last ? [tag] : []
  for (const v of ticks) {
    const y = Math.round((top - v) / perRow)
    if (y < 0 || y > end || used.some(u => Math.abs(u - y) <= 1)) continue
    used.push(y)
    write(y, step > 0 ? fmtTick(v, step) : fmtPrice(v), LABEL, DEFAULT)
  }
  if (last) {
    const y = tag
    const isUp = last.c >= last.o
    write(y, fmtPrice(last.c), isUp ? pal.upText : pal.downText, isUp ? pal.up : pal.down)
  }
}

/** The cells of a chart `columns` x `rows`, row-major, ready to pack. */
export function chartCells(input: ChartInput, columns: number, rows: number): Cell[] {
  const blank: Cell = [0x20, DEFAULT, DEFAULT]
  const cells: Cell[] = Array.from({ length: columns * rows }, () => [...blank] as Cell)
  const set = (x: number, y: number, cell: Cell) => {
    if (x >= 0 && x < columns && y >= 0 && y < rows) cells[y * columns + x] = cell
  }
  const get = (x: number, y: number): Cell | undefined => cells[y * columns + x]
  const pal = input.palette ?? PALETTES.classic
  const L = layoutFor(input, columns)
  const halves = rows * 2
  const yOf = (price: number) => Math.round(((L.hi - price) / (L.hi - L.lo)) * (halves - 1))
  const last = input.candles[input.candles.length - 1]

  // Last price: a dotted line across the empty cells.
  if (last) {
    const row = Math.floor(yOf(last.c) / 2)
    for (let x = 0; x < columns - L.axis; x++) set(x, row, [0x2508, GRID, DEFAULT])
  }

  // Candles, one per column, right-aligned to the forecast zone.
  const start = L.plot - L.shown.length
  const cursorAt = L.shown.length - 1 - Math.max(0, Math.min(input.cursor, L.shown.length - 1))
  L.shown.forEach((c, i) => {
    const x = start + i
    const color = c.c >= c.o ? pal.up : pal.down
    const wickTop = yOf(c.h)
    const wickBottom = yOf(c.l)
    let bodyTop = yOf(Math.max(c.o, c.c))
    let bodyBottom = yOf(Math.min(c.o, c.c))
    if (bodyBottom < bodyTop) [bodyTop, bodyBottom] = [bodyBottom, bodyTop]
    const isCursor = i === cursorAt && input.cursor > 0
    for (let y = 0; y < rows; y++) {
      const top = y * 2
      const bottom = y * 2 + 1
      const state = (h: number) => (h >= bodyTop && h <= bodyBottom ? 2 : h >= wickTop && h <= wickBottom ? 1 : 0)
      const a = state(top)
      const b = state(bottom)
      const bg = isCursor ? CURSOR_BG : DEFAULT
      // Heavy strokes for the body, light ones for the wick, each half a row: narrow, so candles keep a gap between them.
      let glyph = 0
      if (a === 2 && b === 2) glyph = 0x2503
      else if (a === 2) glyph = b === 1 ? 0x257f : 0x2579
      else if (b === 2) glyph = a === 1 ? 0x257d : 0x257b
      else if (a === 1 && b === 1) glyph = 0x2502
      else if (a === 1) glyph = 0x2575
      else if (b === 1) glyph = 0x2577
      if (glyph !== 0) set(x, y, [glyph, color, bg])
      else if (isCursor) {
        const cur = get(x, y)
        set(x, y, [cur?.[0] ?? 0x20, cur?.[1] ?? DEFAULT, CURSOR_BG])
      }
    }
  })

  // The DaviddTech+ fan in one ink: light shade for the 80% range, medium shade
  // for the 50% range, a thin line in the cell that holds the middle. A cell
  // takes the stronger class of its two half rows. Shade glyphs mix with the
  // terminal's own background, so the fan stays soft on light and dark.
  if (input.fan && L.fan > 0 && last) {
    const x0 = L.plot
    for (let y = 0; y < rows; y++) set(x0, y, [0x250a, GRID, DEFAULT])
    const width = L.fan - 1
    const glyphs = [0, FAN_GLYPHS.range80, FAN_GLYPHS.range50, FAN_GLYPHS.middle]
    for (let i = 0; i < width; i++) {
      const p = fanAt(input.fan, last.c, (i + 1) / width)
      const y10 = yOf(p.p10)
      const y25 = yOf(p.p25)
      const y50 = yOf(p.p50)
      const y75 = yOf(p.p75)
      const y90 = yOf(p.p90)
      const classAt = (h: number): number => (h === y50 ? 3 : h >= y75 && h <= y25 ? 2 : h >= y90 && h <= y10 ? 1 : 0)
      for (let y = 0; y < rows; y++) {
        const k = Math.max(classAt(y * 2), classAt(y * 2 + 1))
        const glyph = glyphs[k] ?? 0
        if (glyph !== 0) set(x0 + 1 + i, y, [glyph, pal.fan, DEFAULT])
      }
    }
  }

  // Paths ahead (moments like now): braille dots, one column a candle from the anchor; the others dim, the middle in
  // the layer's ink. A dotted rule marks where the candles end.
  const g = !input.fan && input.ghost && L.fan > 0 ? input.ghost : null
  const anchor = g ? input.candles[g.anchor] : undefined
  if (g && anchor) {
    const x0 = L.plot
    for (let y = 0; y < rows; y++) set(x0, y, [0x250a, GRID, DEFAULT])
    const ax = start + (L.shown.length - 1) - (input.candles.length - 1 - g.anchor)
    const quarters = rows * 4
    const qOf = (price: number) => Math.round(((L.hi - price) / (L.hi - L.lo)) * (quarters - 1))
    const bits = new Map<number, { bits: number; ink: number }>()
    const DOTS = [0x01, 0x02, 0x04, 0x40]
    const DOTS_R = [0x08, 0x10, 0x20, 0x80]
    const dot = (x: number, q: number, right: boolean, ink: number, strong: boolean) => {
      const y = Math.floor(q / 4)
      if (x <= x0 || x >= columns - L.axis || y < 0 || y >= rows) return
      const key = y * columns + x
      const was = bits.get(key)
      const bit = (right ? DOTS_R : DOTS)[q % 4] ?? 0
      bits.set(key, { bits: (was?.bits ?? 0) | bit, ink: strong || !was ? ink : was.ink })
    }
    const line = (path: readonly number[], ink: number, strong: boolean) => {
      let prev = qOf(anchor.c)
      path.forEach((v, s) => {
        const q = qOf(anchor.c * (1 + v))
        const x = ax + s + 1
        // The middle joins from the last dot so a big move stays one line; the others are single dots, a light haze.
        if (strong) {
          const [a, b] = prev <= q ? [prev, q] : [q, prev]
          for (let k = a; k <= b; k++) dot(x, k, false, ink, strong)
        }
        dot(x, q, true, ink, strong)
        prev = q
      })
    }
    for (const p of g.paths) line(p, LABEL, false)
    line(g.median, g.ink, true)
    for (const [key, v] of bits) {
      const x = key % columns
      const y = Math.floor(key / columns)
      set(x, y, [0x2800 + v.bits, v.ink, DEFAULT])
    }
  }

  const priceAt = (y: number) => L.hi - ((y * 2 + 0.5) / (halves - 1)) * (L.hi - L.lo)
  drawAxis(set, columns, rows, L.axis, priceAt, last, last ? Math.floor(yOf(last.c) / 2) : 0, pal)
  return cells
}

export type LineLayout = { axis: number; plot: number; shown: Candle[]; lo: number; hi: number }

/** The line view's layout: two closes per column, right-aligned, scaled from the closes with 3% padding. */
export function lineLayout(input: ChartInput, columns: number): LineLayout {
  const last = input.candles[input.candles.length - 1]
  const axis = axisWidth(columns, last?.c ?? 0)
  const plot = Math.max(1, columns - axis)
  const shown = input.candles.slice(-plot * 2)
  let lo = Infinity
  let hi = -Infinity
  for (const c of shown) {
    lo = Math.min(lo, c.c)
    hi = Math.max(hi, c.c)
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0
    hi = 1
  }
  if (hi - lo < Math.abs(hi) * 1e-6 || hi === lo) {
    const pad = Math.abs(hi) * 0.001 || 1
    lo -= pad
    hi += pad
  }
  const pad = (hi - lo) * 0.03
  return { axis, plot, shown, lo: lo - pad, hi: hi + pad }
}

/** Braille dot bits: left column top to bottom, then right column top to bottom. */
const DOTS_LEFT = [0x01, 0x02, 0x04, 0x40] as const
const DOTS_RIGHT = [0x08, 0x10, 0x20, 0x80] as const

/**
 * The narrow chart (under 40 columns): the closes as one braille line, two
 * closes per column and four dots per row, each point joined to the one
 * before. Up color when the last close is at or above the first one shown.
 * Axis and last-price tag as on the candle chart; no fan, no dotted line.
 */
export function lineCells(input: ChartInput, columns: number, rows: number): Cell[] {
  const blank: Cell = [0x20, DEFAULT, DEFAULT]
  const cells: Cell[] = Array.from({ length: columns * rows }, () => [...blank] as Cell)
  const set = (x: number, y: number, cell: Cell) => {
    if (x >= 0 && x < columns && y >= 0 && y < rows) cells[y * columns + x] = cell
  }
  const pal = input.palette ?? PALETTES.classic
  const L = lineLayout(input, columns)
  const dotRows = rows * 4
  const yOf = (price: number) => Math.max(0, Math.min(dotRows - 1, Math.round(((L.hi - price) / (L.hi - L.lo)) * (dotRows - 1))))
  const bits = new Uint8Array(L.plot * rows)
  const dot = (dx: number, dy: number) => {
    if (dx < 0 || dx >= L.plot * 2 || dy < 0 || dy >= dotRows) return
    const i = Math.floor(dy / 4) * L.plot + Math.floor(dx / 2)
    bits[i] = (bits[i] ?? 0) | ((dx % 2 === 1 ? DOTS_RIGHT : DOTS_LEFT)[dy % 4] ?? 0)
  }
  const offset = L.plot * 2 - L.shown.length
  let prev: number | null = null
  L.shown.forEach((c, k) => {
    const dx = offset + k
    const y = yOf(c.c)
    if (prev === null) dot(dx, y)
    else {
      // Fill the dots between the two points: the half near the last point in its column, the rest in this one.
      const from: number = prev
      const step = y >= from ? 1 : -1
      for (let h = from; h !== y + step; h += step) dot(Math.abs(h - from) < Math.abs(y - h) ? dx - 1 : dx, h)
    }
    prev = y
  })
  const first = L.shown[0]
  const last = L.shown[L.shown.length - 1]
  const color = first && last && last.c < first.c ? pal.down : pal.up
  const cursorAt = input.cursor > 0 && L.shown.length > 0 ? offset + L.shown.length - 1 - Math.min(input.cursor, L.shown.length - 1) : -1
  const cursorColumn = cursorAt >= 0 ? Math.floor(cursorAt / 2) : -1
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < L.plot; x++) {
      const b = bits[y * L.plot + x] ?? 0
      const bg = x === cursorColumn ? CURSOR_BG : DEFAULT
      set(x, y, b === 0 ? [0x20, DEFAULT, bg] : [0x2800 + b, color, bg])
    }
  }
  const lastCandle = input.candles[input.candles.length - 1]
  const priceAt = (y: number) => L.hi - ((y * 4 + 1.5) / (dotRows - 1)) * (L.hi - L.lo)
  drawAxis(set, columns, rows, L.axis, priceAt, lastCandle, lastCandle ? Math.floor(yOf(lastCandle.c) / 4) : 0, pal)
  return cells
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Bytes to standard padded base64 (our own: the module has no Buffer). */
export function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]
    out += B64[(n >> 12) & 63]
    out += b === undefined ? '=' : B64[(n >> 6) & 63]
    out += c === undefined ? '=' : B64[n & 63]
  }
  return out
}

/** Cells packed as RasterProps wants: little-endian u32 triplets in base64. */
export function packCells(cells: readonly Cell[]): string {
  const bytes = new Uint8Array(cells.length * 12)
  const view = new DataView(bytes.buffer)
  cells.forEach((cell, i) => {
    view.setUint32(i * 12, cell[0], true)
    view.setUint32(i * 12 + 4, cell[1], true)
    view.setUint32(i * 12 + 8, cell[2], true)
  })
  return base64(bytes)
}

/** The time line under the terminal chart: first and last candle, and the forecast's reach. `isLine` for the line view. */
export function timeAxis(input: ChartInput, interval: string, columns: number, fanLabel: string | null, isLine = false): string {
  const L = isLine ? { ...lineLayout(input, columns), fan: 0 } : layoutFor(input, columns)
  const first = L.shown[0]
  const last = L.shown[L.shown.length - 1]
  if (!first || !last) return ''
  const left = fmtTime(first.t, interval)
  const right = fmtTime(last.t, interval)
  const candleZone = L.plot
  const gap = candleZone - left.length - right.length
  let line = gap >= 1 ? left + ' '.repeat(gap) + right : right.padStart(candleZone)
  if (L.fan > 0 && fanLabel) line += ' ' + fanLabel.slice(0, L.fan - 1).padEnd(L.fan - 1)
  return line.slice(0, columns)
}

/** "Tue 16 Nov 14:00 UTC · O 97,100 H 97,450 L 96,900 C 97,300 · +0.21% · vol 1,234": the candle under the cursor. */
export function readout(candles: readonly Candle[], cursor: number, interval: string, columns = Infinity): string {
  const i = candles.length - 1 - Math.max(0, Math.min(cursor, candles.length - 1))
  const c = candles[i]
  if (!c) return 'No candles yet.'
  const change = c.o === 0 ? null : ((c.c - c.o) / c.o) * 100
  const vol = c.v >= 1000 ? fmtPrice(Math.round(c.v)) : c.v.toFixed(2)
  const tag = cursor > 0 ? `${cursor} back · ` : 'last · '
  const full = `${tag}${fmtTime(c.t, interval)} UTC · O ${fmtPrice(c.o)} H ${fmtPrice(c.h)} L ${fmtPrice(c.l)} C ${fmtPrice(c.c)} · ${fmtPct(change)} · vol ${vol}`
  if (full.length <= columns) return full
  // Narrow: the prices first (the useful part), then the time if it fits.
  const prices = `${cursor > 0 ? `${cursor} back · ` : ''}O ${fmtPrice(c.o)} H ${fmtPrice(c.h)} L ${fmtPrice(c.l)} C ${fmtPrice(c.c)}`
  const withPct = `${prices} ${fmtPct(change)}`
  const base = withPct.length <= columns ? withPct : prices
  const withTime = `${base} · ${fmtTime(c.t, interval)}`
  return withTime.length <= columns ? withTime : base
}

/** The line view's short readout: "65,137 +0.21% · Tue 16 Nov 14:00", with "3 back · " first when the cursor is back. */
export function lineReadout(candles: readonly Candle[], cursor: number, interval: string): string {
  const i = candles.length - 1 - Math.max(0, Math.min(cursor, candles.length - 1))
  const c = candles[i]
  if (!c) return 'No candles yet.'
  const change = c.o === 0 ? null : ((c.c - c.o) / c.o) * 100
  return `${cursor > 0 ? `${cursor} back · ` : ''}${fmtPrice(c.c)} ${fmtPct(change)} · ${fmtTime(c.t, interval)}`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0')
}

export const SVG_WIDTH = 720
export const SVG_HEIGHT = 340
/** Candles sit on a fixed pitch, so a hollow body stays readable in a sidebar: 62 with the fan, 80 without. */
export const SVG_PITCH = 8
const SVG_BODY = 5.6
const SVG_STROKE = 1.5

/** How many candles the SVG shows for a plot this wide. */
export function svgCandleCount(plotW: number): number {
  return Math.max(1, Math.floor(plotW / SVG_PITCH))
}

/** The chart as an SVG document: candles with a tooltip each, the fan, the last price, axes. */
export function chartSvg(input: ChartInput, interval: string, coin: string, fanLabel: string | null): string {
  const W = SVG_WIDTH
  const H = SVG_HEIGHT
  const right = 78
  const bottom = 22
  const top = 8
  const pal = input.palette ?? PALETTES.classic
  const fanInk = hex(pal.fan)
  const hasFan = input.fan !== null && input.candles.length > 0
  const fanW = hasFan ? Math.round((W - right) * 0.22) : 0
  const plotW = W - right - fanW
  const plotH = H - top - bottom
  const candles = input.candles.slice(-svgCandleCount(plotW))
  const last = candles[candles.length - 1]
  let lo = Infinity
  let hi = -Infinity
  for (const c of candles) {
    lo = Math.min(lo, c.l)
    hi = Math.max(hi, c.h)
  }
  if (input.fan && last) {
    const [flo, fhi] = fanRange(input.fan, last.c)
    lo = Math.min(lo, flo)
    hi = Math.max(hi, fhi)
  }
  if (!Number.isFinite(lo)) {
    lo = 0
    hi = 1
  }
  if (hi === lo) {
    lo -= 1
    hi += 1
  }
  const pad = (hi - lo) * 0.04
  lo -= pad
  hi += pad
  const Y = (p: number) => top + ((hi - p) / (hi - lo)) * plotH
  const x0 = plotW - candles.length * SVG_PITCH
  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="11">`)
  // Grid and price labels.
  for (let k = 0; k <= 4; k++) {
    const p = hi - ((hi - lo) * k) / 4
    const y = Y(p).toFixed(1)
    parts.push(`<line x1="0" x2="${W - right}" y1="${y}" y2="${y}" stroke="#8a8f98" stroke-opacity="0.18"/>`)
    parts.push(`<text x="${W - right + 6}" y="${(Number(y) + 4).toFixed(1)}" fill="#8a8f98">${esc(fmtPrice(p))}</text>`)
  }
  // The fan: two see-through bands and a thin middle line, all in the fan ink.
  if (input.fan && last && fanW > 0) {
    const fx = plotW
    const n = 24
    const pts = Array.from({ length: n + 1 }, (_, i) => fanAt(input.fan as Fan, last.c, i / n))
    const X = (t: number) => (fx + t * (fanW - 4)).toFixed(1)
    const area = (a: 'p10' | 'p25', b: 'p90' | 'p75') =>
      pts.map(p => `${X(p.x)},${Y(p[b]).toFixed(1)}`).join(' ') + ' ' + [...pts].reverse().map(p => `${X(p.x)},${Y(p[a]).toFixed(1)}`).join(' ')
    parts.push(`<line x1="${fx}" x2="${fx}" y1="${top}" y2="${top + plotH}" stroke="#8a8f98" stroke-opacity="0.4" stroke-dasharray="2 3"/>`)
    parts.push(`<polygon points="${area('p10', 'p90')}" fill="${fanInk}" fill-opacity="0.18"><title>${esc('80% range')}</title></polygon>`)
    parts.push(`<polygon points="${area('p25', 'p75')}" fill="${fanInk}" fill-opacity="0.34"><title>${esc('50% range')}</title></polygon>`)
    parts.push(
      `<polyline points="${pts.map(p => `${X(p.x)},${Y(p.p50).toFixed(1)}`).join(' ')}" fill="none" stroke="${fanInk}" stroke-width="1" stroke-opacity="0.6"><title>${esc('middle path')}</title></polyline>`,
    )
    if (fanLabel) parts.push(`<text x="${fx + 4}" y="${H - 6}" fill="#8a8f98">${esc(fanLabel)}</text>`)
  }
  // Candles: up hollow, down filled; a body under 3 units is one line.
  candles.forEach((c, i) => {
    const cx = x0 + i * SVG_PITCH + SVG_PITCH / 2
    const isUp = c.c >= c.o
    const color = hex(isUp ? pal.up : pal.down)
    const yTop = Y(Math.max(c.o, c.c))
    const yBot = Y(Math.min(c.o, c.c))
    const yHigh = Y(c.h)
    const yLow = Y(c.l)
    const change = c.o === 0 ? null : ((c.c - c.o) / c.o) * 100
    const tip = `${fmtTime(c.t, interval)} UTC  O ${fmtPrice(c.o)}  H ${fmtPrice(c.h)}  L ${fmtPrice(c.l)}  C ${fmtPrice(c.c)}  ${fmtPct(change)}`
    const x = cx.toFixed(1)
    const left = cx - SVG_BODY / 2
    const wick = (a: number, b: number) => (b - a > 0.05 ? `<line x1="${x}" x2="${x}" y1="${a.toFixed(1)}" y2="${b.toFixed(1)}" stroke="${color}"/>` : '')
    let body: string
    if (yBot - yTop < 3) {
      const ym = ((yTop + yBot) / 2).toFixed(1)
      body = wick(yHigh, yLow) + `<line x1="${left.toFixed(1)}" x2="${(left + SVG_BODY).toFixed(1)}" y1="${ym}" y2="${ym}" stroke="${color}" stroke-width="${SVG_STROKE}"/>`
    } else if (isUp) {
      const inset = SVG_STROKE / 2
      body =
        wick(yHigh, yTop) +
        wick(yBot, yLow) +
        `<rect x="${(left + inset).toFixed(2)}" y="${(yTop + inset).toFixed(1)}" width="${(SVG_BODY - SVG_STROKE).toFixed(1)}" height="${(yBot - yTop - SVG_STROKE).toFixed(1)}" fill="transparent" stroke="${color}" stroke-width="${SVG_STROKE}"/>`
    } else {
      body = wick(yHigh, yLow) + `<rect x="${left.toFixed(1)}" y="${yTop.toFixed(1)}" width="${SVG_BODY}" height="${(yBot - yTop).toFixed(1)}" fill="${color}"/>`
    }
    parts.push(`<g><title>${esc(tip)}</title>${body}</g>`)
  })
  // Last price.
  if (last) {
    const y = Y(last.c).toFixed(1)
    const isUp = last.c >= last.o
    const color = hex(isUp ? pal.up : pal.down)
    parts.push(`<line x1="0" x2="${W - right}" y1="${y}" y2="${y}" stroke="${color}" stroke-opacity="0.7" stroke-dasharray="3 3"/>`)
    parts.push(`<rect x="${W - right + 2}" y="${(Number(y) - 8).toFixed(1)}" width="${right - 4}" height="16" rx="2" fill="${color}"/>`)
    parts.push(`<text x="${W - right + 6}" y="${(Number(y) + 4).toFixed(1)}" fill="${hex(isUp ? pal.upText : pal.downText)}">${esc(fmtPrice(last.c))}</text>`)
  }
  // Time labels.
  const first = candles[0]
  if (first && last) {
    parts.push(`<text x="${Math.max(2, x0 + 2).toFixed(1)}" y="${H - 6}" fill="#8a8f98">${esc(fmtTime(first.t, interval))}</text>`)
    parts.push(`<text x="${plotW - 2}" y="${H - 6}" fill="#8a8f98" text-anchor="end">${esc(fmtTime(last.t, interval))}</text>`)
  }
  parts.push(`<text x="4" y="${top + 12}" fill="#8a8f98">${esc(coin + ' · ' + interval)}</text>`)
  parts.push('</svg>')
  return parts.join('')
}

/** What the chart says, for a reader that cannot see it. */
export function chartAlt(coin: string, interval: string, candles: readonly Candle[], hasFan: boolean): string {
  const last = candles[candles.length - 1]
  const first = candles[0]
  if (!last || !first) return `${coin} ${interval} chart, no candles yet`
  const change = first.o === 0 ? null : ((last.c - first.o) / first.o) * 100
  return `${coin} ${interval} candle chart, ${candles.length} candles, last ${fmtPrice(last.c)}, ${fmtPct(change)} over the chart${hasFan ? ', with the DaviddTech+ forecast range' : ''}`
}
