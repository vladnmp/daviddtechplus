// Terminal charts as Raster cells: half blocks give two pixels per cell, the
// right 13 columns carry ASCII labels. Cells are [codePoint, fg, bg] u32
// triplets, little-endian, in standard padded base64 (our own encoder: the
// es2023 lib does not type Uint8Array.toBase64).

import type { Chart } from '../types'
import { chance, clamp, day, pct } from './model'

export const DEFAULT = 0x01000000
export const COLORS = {
  /** The fan ink: the 80% and 50% ranges and the middle, one color, weight from the glyph. */
  fan: 0x4c8bf5,
  /** The zero line: reads on light and dark terminals. */
  neutral: 0x77808c,
  level: 0x8a94a6,
  zero: 0x4a4f57,
  dim: 0x6b7280,
} as const
/** At most 3 odds lines: blue shades, the 2nd dashed and the 3rd dotted, each labelled at its end. */
export const ODDS_COLORS = [0x4c8bf5, 0x3a6fd0, 0x7aa6f7] as const
const ODDS_DRAWN = [(_x: number) => true, (x: number) => x % 3 !== 2, (x: number) => x % 2 === 0]
export const LABEL_W = 13

const UPPER = 0x2580 // '▀'
const LOWER = 0x2584 // '▄'
const HEAVY = 0x2503 // '┃'
const LIGHT = 0x2502 // '│'
/** The fan's glyphs: light shade (80% range), medium shade (50% range), thin line (middle), dotted line (zero). */
export const GLYPHS = { range80: 0x2591, range50: 0x2592, middle: 0x2500, zero: 0x2508 } as const

export type RasterChart = { columns: number; rows: number; cells: string }

/** Raster size for a pane body: columns clamped to [20, 512], rows to [6, 20]. */
export function rasterSize(bodyColumns: number, bodyRows: number): { columns: number; rows: number } {
  return { columns: clamp(Math.floor(bodyColumns), 20, 512), rows: clamp(Math.floor(bodyRows) - 9, 6, 20) }
}

/** The terminal chart for `chart`, or null when it has nothing to draw (a card, a plan). */
export function rasterFor(chart: Chart, columns: number, rows: number): RasterChart | null {
  if (chart.kind === 'brief' && chart.path.length >= 2) return fanRaster(chart, columns, rows)
  if (chart.kind === 'odds' && chart.odds.some(o => o.values.length >= 2)) return oddsRaster(chart, columns, rows)
  if (chart.kind === 'scan' && chart.rows.length > 0) return scanRaster(chart, columns, rows)
  return null
}

/** The date axis under a terminal chart, padded to the chart's columns. */
export function axisLine(chart: Chart, columns: number): string {
  const first = chart.kind === 'brief' ? chart.path[0]?.session ?? chart.asOf : chart.asOf
  const left = day(first ?? null) || chart.fromLabel || ''
  const right = day(chart.endDate) || chart.endLabel || ''
  const width = Math.max(4, columns - LABEL_W)
  const gap = Math.max(1, width - left.length - right.length)
  return `${left}${' '.repeat(gap)}${right}`
}

// ---------------------------------------------------------------- grid

class Cells {
  readonly words: Uint32Array
  readonly columns: number
  readonly rows: number
  constructor(columns: number, rows: number) {
    this.columns = columns
    this.rows = rows
    this.words = new Uint32Array(columns * rows * 3)
    for (let i = 0; i < columns * rows; i++) this.put(i % columns, Math.floor(i / columns), 0x20, DEFAULT, DEFAULT)
  }
  put(x: number, y: number, cp: number, fg: number, bg: number): void {
    if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) return
    const i = (y * this.columns + x) * 3
    this.words[i] = cp
    this.words[i + 1] = fg
    this.words[i + 2] = bg
  }
  /** Two pixels into one cell, so a default color never paints with the text color. */
  pixels(x: number, y: number, top: number, bottom: number): void {
    if (top === DEFAULT && bottom === DEFAULT) this.put(x, y, 0x20, DEFAULT, DEFAULT)
    else if (top === DEFAULT) this.put(x, y, LOWER, bottom, DEFAULT)
    else if (bottom === DEFAULT) this.put(x, y, UPPER, top, DEFAULT)
    else if (top === bottom) this.put(x, y, 0x20, DEFAULT, top)
    else this.put(x, y, UPPER, top, bottom)
  }
  text(x: number, y: number, words: string, fg: number, width: number): void {
    const t = ascii(words).slice(0, width)
    for (let k = 0; k < t.length; k++) this.put(x + k, y, t.charCodeAt(k), t[k] === ' ' ? DEFAULT : fg, DEFAULT)
  }
  done(): RasterChart {
    return { columns: this.columns, rows: this.rows, cells: toBase64(this.words) }
  }
}

function ascii(s: string): string {
  return s.replace(/−/g, '-').replace(/[^\x20-\x7e]/g, '?')
}

type Label = { row: number; text: string; color: number }

/** Spreads label rows apart by one row at least, inside [min, max]; drops what does not fit. */
export function spread(items: Label[], min: number, max: number): Label[] {
  const room = Math.max(0, max - min + 1)
  const list = items.slice(0, room).sort((a, b) => a.row - b.row)
  for (let i = 0; i < list.length; i++) list[i]!.row = Math.max(list[i]!.row, i ? list[i - 1]!.row + 1 : min)
  for (let j = list.length - 1; j >= 0; j--) list[j]!.row = Math.min(list[j]!.row, j < list.length - 1 ? list[j + 1]!.row - 1 : max)
  return list
}

function lerp(values: number[], t: number): number {
  const i = Math.floor(t)
  const f = t - i
  const a = values[clamp(i, 0, values.length - 1)] ?? 0
  const b = values[clamp(i + 1, 0, values.length - 1)] ?? a
  return a + (b - a) * f
}

/** Levels are grey; their labels say which is which. Color is kept for the forecast (blue). */
function levelColor(_kind: Chart['levels'][number]['kind']): number {
  return COLORS.level
}

/**
 * The levels a fan draws, kept simple: the break level, then up to 2 resistances and 2 supports,
 * only those close to the 80% range (so a far level never squashes the fan), one line per price.
 */
export function fanLevels(chart: Chart): Chart['levels'] {
  const brk = chart.levels.filter(l => l.kind === 'break').slice(0, 1)
  const res = chart.levels.filter(l => l.kind === 'resistance').slice(0, 2)
  const sup = chart.levels.filter(l => l.kind === 'support').slice(0, 2)
  let lo = 0
  let hi = 0
  for (const p of chart.path) {
    lo = Math.min(lo, p.p10)
    hi = Math.max(hi, p.p90)
  }
  const reach = (hi - lo) * 0.25
  const seen = new Set<string>()
  return [...brk, ...res, ...sup].filter(l => {
    const key = l.pct.toFixed(1)
    if (seen.has(key) || l.pct <= lo - reach || l.pct >= hi + reach) return false
    seen.add(key)
    return true
  })
}

/** The value range a fan spans: path, zero and its levels, padded 8%. */
export function fanRange(chart: Chart): { lo: number; hi: number } {
  let lo = 0
  let hi = 0
  for (const p of chart.path) {
    lo = Math.min(lo, p.p10)
    hi = Math.max(hi, p.p90)
  }
  for (const l of fanLevels(chart)) {
    lo = Math.min(lo, l.pct)
    hi = Math.max(hi, l.pct)
  }
  const pad = (hi - lo) * 0.08 || 0.5
  return { lo: lo - pad, hi: hi + pad }
}

// ---------------------------------------------------------------- fan

export function fanRaster(chart: Chart, columns: number, rows: number): RasterChart {
  const cells = new Cells(columns, rows)
  const cc = Math.max(4, columns - LABEL_W)
  const ph = rows * 2
  const path = chart.path
  const n = path.length - 1
  const { lo, hi } = fanRange(chart)
  const span = hi - lo
  const rowOf = (v: number) => clamp(Math.round(((hi - v) / span) * ph - 0.5), 0, ph - 1)
  const series = (k: 'p10' | 'p25' | 'p50' | 'p75' | 'p90') => path.map(p => p[k])
  const [s10, s25, s50, s75, s90] = [series('p10'), series('p25'), series('p50'), series('p75'), series('p90')]
  const levels = fanLevels(chart)
  // Per half row: band class (0 none, 1 80% range, 2 50% range), the middle, and a level's color.
  const band = new Uint8Array(cc * ph)
  const mid = new Uint8Array(cc * ph)
  const lvl = new Uint32Array(cc * ph).fill(DEFAULT)
  const zero = rowOf(0)
  let prev = -1
  for (let x = 0; x < cc; x++) {
    const t = cc === 1 ? n : (x / (cc - 1)) * n
    const [p10, p25, p50, p75, p90] = [lerp(s10, t), lerp(s25, t), lerp(s50, t), lerp(s75, t), lerp(s90, t)]
    for (let y = 0; y < ph; y++) {
      const v = hi - ((y + 0.5) / ph) * span
      band[y * cc + x] = v >= p25 && v <= p75 ? 2 : v >= p10 && v <= p90 ? 1 : 0
    }
    if (x % 4 !== 3) for (const l of levels) lvl[rowOf(l.pct) * cc + x] = levelColor(l.kind)
    const yp = rowOf(p50)
    const from = prev < 0 ? yp : prev
    // Fill from the last column's row so a steep path stays one line.
    for (let y = Math.min(from, yp); y <= Math.max(from, yp); y++) mid[y * cc + x] = 1
    prev = yp
  }
  // One glyph per cell, low to high: band, zero, middle, level. Levels stay half-block lines.
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < cc; x++) {
      const a = 2 * r * cc + x
      const b = (2 * r + 1) * cc + x
      if (lvl[a] !== DEFAULT || lvl[b] !== DEFAULT) cells.pixels(x, r, lvl[a]!, lvl[b]!)
      else if (mid[a] || mid[b]) cells.put(x, r, GLYPHS.middle, COLORS.fan, DEFAULT)
      else if (zero === 2 * r || zero === 2 * r + 1) cells.put(x, r, GLYPHS.zero, COLORS.neutral, DEFAULT)
      else {
        const k = Math.max(band[a]!, band[b]!)
        if (k > 0) cells.put(x, r, k === 2 ? GLYPHS.range50 : GLYPHS.range80, COLORS.fan, DEFAULT)
      }
    }
  }
  const width = columns - cc - 1
  if (width > 0) {
    cells.text(cc + 1, 0, pct(hi), COLORS.dim, width)
    cells.text(cc + 1, rows - 1, pct(lo), COLORS.dim, width)
    const labels = spread(
      levels.map(l => ({
        row: Math.floor(rowOf(l.pct) / 2),
        text: `${pct(l.pct)}${l.touch === null ? '' : ` ${chance(l.touch)}`}`,
        color: levelColor(l.kind),
      })),
      1,
      rows - 2,
    )
    for (const it of labels) cells.text(cc + 1, it.row, it.text, it.color, width)
  }
  return cells.done()
}

// ---------------------------------------------------------------- odds

export function oddsRaster(chart: Chart, columns: number, rows: number): RasterChart {
  const cells = new Cells(columns, rows)
  const cc = Math.max(4, columns - LABEL_W)
  const ph = rows * 2
  const lines = chart.odds.slice(0, ODDS_COLORS.length)
  const rowOf = (v: number) => clamp(Math.round((1 - clamp(v, 0, 1)) * (ph - 1)), 0, ph - 1)
  const pix = new Uint32Array(cc * ph).fill(DEFAULT)
  for (let x = 0; x < cc; x++) {
    pix[(ph - 1) * cc + x] = COLORS.zero
    if (x % 4 !== 3) pix[rowOf(0.5) * cc + x] = COLORS.zero
  }
  lines.forEach((line, j) => {
    const n = line.values.length - 1
    const color = ODDS_COLORS[j] ?? COLORS.level
    const drawn = ODDS_DRAWN[j] ?? ODDS_DRAWN[0]!
    let prev = -1
    for (let x = 0; x < cc; x++) {
      const t = cc === 1 ? n : (x / (cc - 1)) * n
      const y = rowOf(lerp(line.values, t))
      const from = prev < 0 ? y : prev
      if (drawn(x)) for (let k = Math.min(from, y); k <= Math.max(from, y); k++) pix[k * cc + x] = color
      prev = y
    }
  })
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < cc; x++) cells.pixels(x, r, pix[2 * r * cc + x]!, pix[(2 * r + 1) * cc + x]!)
  }
  const width = columns - cc - 1
  if (width > 0) {
    cells.text(cc + 1, 0, '100%', COLORS.dim, width)
    cells.text(cc + 1, rows - 1, '0%', COLORS.dim, width)
    const labels = spread(
      lines.map((line, j) => {
        const last = chart.levels[j]?.touch ?? line.values[line.values.length - 1] ?? 0
        return { row: Math.floor(rowOf(last) / 2), text: `${line.name} ${chance(last)}`, color: ODDS_COLORS[j] ?? COLORS.level }
      }),
      1,
      rows - 2,
    )
    for (const it of labels) cells.text(cc + 1, it.row, it.text, it.color, width)
  }
  return cells.done()
}

// ---------------------------------------------------------------- scan

export function scanRaster(chart: Chart, columns: number, maxRows: number): RasterChart {
  const list = chart.rows.slice(0, maxRows)
  const rows = Math.max(1, list.length)
  const cells = new Cells(columns, rows)
  const symW = 8
  const labW = columns >= 40 ? LABEL_W : 0
  const bw = Math.max(4, columns - symW - labW)
  let lo = 0
  let hi = 0
  for (const r of list) {
    lo = Math.min(lo, r.range80[0])
    hi = Math.max(hi, r.range80[1])
  }
  const pad = (hi - lo) * 0.05 || 0.5
  lo -= pad
  hi += pad
  const colOf = (v: number) => clamp(Math.round(((v - lo) / (hi - lo)) * (bw - 1)), 0, bw - 1)
  const z = colOf(0)
  list.forEach((r, y) => {
    cells.text(0, y, r.symbol, COLORS.level, symW - 1)
    const a = colOf(r.range80[0])
    const b = colOf(r.range80[1])
    const m = colOf(r.middle)
    for (let x = 0; x < bw; x++) {
      if (x === m) cells.put(symW + x, y, HEAVY, COLORS.fan, DEFAULT)
      else if (x === z) cells.put(symW + x, y, LIGHT, COLORS.neutral, DEFAULT)
      else if (x >= a && x <= b) cells.put(symW + x, y, GLYPHS.range50, COLORS.fan, DEFAULT)
      else cells.put(symW + x, y, 0x20, DEFAULT, DEFAULT)
    }
    if (labW) cells.text(symW + bw + 1, y, `${pct(r.range80[0])} ${pct(r.range80[1])}`, COLORS.dim, labW - 1)
  })
  return cells.done()
}

// ---------------------------------------------------------------- base64

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** u32 words to standard padded base64 of their little-endian bytes. */
export function toBase64(words: Uint32Array): string {
  const bytes = new Uint8Array(words.length * 4)
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    bytes[i * 4] = w & 0xff
    bytes[i * 4 + 1] = (w >>> 8) & 0xff
    bytes[i * 4 + 2] = (w >>> 16) & 0xff
    bytes[i * 4 + 3] = (w >>> 24) & 0xff
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0
    const n = (a << 16) | (b << 8) | c
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? ALPHABET[n & 63]! : '='
  }
  return out
}

/** Base64 back to u32 words (little-endian), for tests. */
export function fromBase64(text: string): Uint32Array {
  const clean = text.replace(/=+$/, '')
  const bytes: number[] = []
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].map(k => (i + k < clean.length ? ALPHABET.indexOf(clean[i + k]!) : 0))
    const v = (n[0]! << 18) | (n[1]! << 12) | (n[2]! << 6) | n[3]!
    bytes.push((v >> 16) & 0xff)
    if (i + 2 < clean.length) bytes.push((v >> 8) & 0xff)
    if (i + 3 < clean.length) bytes.push(v & 0xff)
  }
  const words = new Uint32Array(Math.floor(bytes.length / 4))
  for (let i = 0; i < words.length; i++) {
    words[i] = (bytes[i * 4]! | (bytes[i * 4 + 1]! << 8) | (bytes[i * 4 + 2]! << 16) | (bytes[i * 4 + 3]! << 24)) >>> 0
  }
  return words
}
