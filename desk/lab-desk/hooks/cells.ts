// The terminal chart with indicators: the candle chart from draw.ts, a legend row over it, indicator
// lines as braille dots in the cells the candles leave empty, and up to two panes under it (RSI, MACD,
// ATR) carved from the same Raster. Pure: no `$`.

import { fmtPrice } from './data'
import type { ChartInput } from './draw'
import { DEFAULT, LABEL, PALETTES, chartCells, layoutFor } from './draw'
import type { Mark } from '../types'
import type { Study } from './indicators'
import { compareStudy, fmtStudy, tail } from './indicators'
import { fibPrices, fmtMark, trendAt } from './marks'
import { INKS } from './svg'

type Cell = [number, number, number]

const GRID = 0x5f6670
/** Marks Claude or /lab-mark drew: light grey, so they read apart from the indicator inks. */
const MARK = 0xc8ccd4
/** Rows one lower pane takes: a title row and five rows of line. */
export const PANE_ROWS = 6
/** The candle chart keeps at least this many rows; lower panes give way first. */
const MIN_PRICE_ROWS = 8
/** Braille with both dot columns lit at one of four heights: ⠉ ⠒ ⠤ ⣀. */
const LEVELS = [0x09, 0x12, 0x24, 0xc0] as const
const LEFT = [0x01, 0x02, 0x04, 0x40] as const
const RIGHT = [0x08, 0x10, 0x20, 0x80] as const

const inkNum = (h: string) => parseInt(h.slice(1), 16)

export type DeskCellsInput = ChartInput & { studies?: readonly Study[]; marks?: readonly Mark[] }

/** How the rows split: legend, candles, lower panes. */
export function rowPlan(rows: number, studies: readonly Study[], hasCompare = false): { legend: number; price: number; lowers: Study[] } {
  const hasPrice = hasCompare || studies.some(s => s.pane === 'price')
  let lowers = studies.filter(s => s.pane === 'lower').slice(0, 2)
  const legend = hasPrice && rows >= MIN_PRICE_ROWS + 1 ? 1 : 0
  while (lowers.length > 0 && rows - legend - PANE_ROWS * lowers.length < MIN_PRICE_ROWS) lowers = lowers.slice(0, -1)
  return { legend, price: rows - legend - PANE_ROWS * lowers.length, lowers }
}

/** The cells of the whole chart `columns` x `rows`, row-major, ready to pack. */
export function deskCells(input: DeskCellsInput, columns: number, rows: number): Cell[] {
  const studies = input.studies ?? []
  const marks = input.marks ?? []
  if (studies.length === 0 && marks.length === 0 && !input.compare) return chartCells(input, columns, rows)
  const pal = input.palette ?? PALETTES.classic
  const inks = (pal === PALETTES.colorblind ? INKS.colorblind : INKS.classic).map(inkNum)
  // The Compare line needs the legend row like a price indicator.
  const plan = rowPlan(rows, studies, !!input.compare)
  const main = chartCells(input, columns, plan.price)
  const L = layoutFor(input, columns)
  const shown = L.shown.length
  const start = L.plot - shown
  const cmp = input.compare ? compareStudy(input.compare.coin, input.candles, input.compare.candles, input.compare.from) : null
  const priceStudies = [...studies.filter(s => s.pane === 'price'), ...(cmp ? [cmp] : [])].map(s => tail(s, shown))
  const lowers = plan.lowers.map(s => tail(s, shown))

  // Ink per study, as on the desktop chart: line studies take slots 1-4 in order.
  const inkOf = new Map<string, number>()
  let slot = 0
  for (const s of studies) if (s.kind !== 'supertrend') inkOf.set(s.id, inks[slot++ % 4] ?? LABEL)

  // Price studies over the candles, only where a cell is empty or holds the last-price dots.
  const dotRows = plan.price * 4
  const dotY = (p: number) => Math.round(((L.hi - p) / (L.hi - L.lo)) * (dotRows - 1))
  // A joined braille line: the left dots climb from the last point, the right dot marks this one; a dashed series
  // (bands' middles) keeps short dashes. Supertrend breaks where it flips sides.
  const dot = (x: number, dy: number, bit: number, color: number) => {
    if (dy < 0 || dy >= dotRows || x < 0 || x >= L.plot) return
    const at = Math.floor(dy / 4) * columns + x
    const cur = main[at]
    if (!cur) return
    const isFree = cur[0] === 0x20 || cur[0] === 0x2508
    const isOurs = cur[0] >= 0x2800 && cur[0] <= 0x28ff
    if (!isFree && !isOurs) return
    main[at] = [0x2800 + ((isOurs ? cur[0] - 0x2800 : 0) | bit), isOurs ? cur[1] : color, cur[2]]
  }
  for (const s of priceStudies) {
    s.series.forEach(se => {
      let prev: number | null = null
      let prevSide: number | null = null
      se.values.forEach((v, i) => {
        if (v === null || v === undefined || !Number.isFinite(v)) {
          prev = null
          return
        }
        const dy = dotY(v)
        const x = start + i
        const side = s.side?.[i] ?? 1
        const color = s.ink ? inkNum(s.ink) : s.kind === 'supertrend' ? (side === 1 ? inks[4] : inks[5]) ?? LABEL : inkOf.get(s.id) ?? LABEL
        if (se.style === 'dash') {
          dot(x, dy, LEVELS[((dy % 4) + 4) % 4] ?? 0, color)
          return
        }
        const from = prev !== null && prevSide === side ? prev : dy
        const lo = Math.max(0, Math.min(from, dy))
        const hi = Math.min(dotRows - 1, Math.max(from, dy))
        for (let d = lo; d <= hi; d++) dot(x, d, LEFT[d % 4] ?? 0, color)
        dot(x, dy, RIGHT[((dy % 4) + 4) % 4] ?? 0, color)
        prev = dy
        prevSide = side
      })
    })
  }

  // Marks: a level is a ╌ row with its label at the left, a zone its two ┄ edges, a note ▼ over its candle.
  // They only take empty cells, so the candles stay readable.
  const rowOf = (p: number) => Math.floor(dotY(p) / 4)
  const put = (x: number, y: number, cp: number) => {
    if (x < 0 || x >= L.plot || y < 0 || y >= plan.price) return false
    const cur = main[y * columns + x]
    if (!cur || (cur[0] !== 0x20 && cur[0] !== 0x2508)) return false
    main[y * columns + x] = [cp, MARK, cur[2]]
    return true
  }
  const isFree = (x: number, y: number) => {
    const cur = main[y * columns + x]
    return !!cur && (cur[0] === 0x20 || cur[0] === 0x2508)
  }
  // Text goes whole into the run of empty cells nearest `near`, or not at all.
  const label = (y: number, text: string, near: number): [number, number] => {
    if (y < 0 || y >= plan.price || text.length === 0) return [0, 0]
    let best = -1
    for (let x = 0; x + text.length <= L.plot; x++) {
      let ok = true
      for (let k = 0; k < text.length && ok; k++) ok = isFree(x + k, y)
      if (ok && (best < 0 || Math.abs(x - near) < Math.abs(best - near))) best = x
    }
    if (best < 0) return [0, 0]
    for (let k = 0; k < text.length; k++) put(best + k, y, text.charCodeAt(k))
    return [best, best + text.length]
  }
  const rowLine = (y: number, cp: number, text: string) => {
    const [a, b] = label(y, text, 1)
    for (let x = 0; x < L.plot; x++) if (x < a || x >= b) put(x, y, cp)
  }
  for (const m of marks) {
    if (m.kind === 'span') continue
    if (m.kind === 'pin') {
      // A layer pin: ▲ under its candle, ▼ over it, • at its price, in the layer's color.
      const i = L.shown.findIndex(c => c.t === m.t)
      const c = L.shown[i]
      if (!c) continue
      const y = m.dir === 'up' ? rowOf(c.l) + 1 : m.dir === 'down' ? rowOf(c.h) - 1 : rowOf(m.price)
      const x = start + i
      if (put(x, y, m.dir === 'up' ? 0x25b2 : m.dir === 'down' ? 0x25bc : 0x2022) && m.ink) {
        const cur = main[y * columns + x]
        if (cur) main[y * columns + x] = [cur[0], inkNum(m.ink), cur[2]]
      }
      continue
    }
    if (m.kind === 'fib') {
      // Each retracement level a dotted row, labelled "0.618".
      for (const f of fibPrices(m)) rowLine(rowOf(f.price), 0x2508, ` ${f.r === 0 || f.r === 1 ? String(f.r) : f.r.toFixed(3).replace(/0+$/, '')} `)
      continue
    }
    if (m.kind === 'trend') {
      // A trend line is a dot on every candle from its first point on, carried to the right edge.
      L.shown.forEach((c, i) => {
        if (m.t === undefined || c.t < m.t) return
        const p = trendAt(m, c.t)
        if (p !== null && p <= L.hi && p >= L.lo) put(start + i, rowOf(p), 0x2022)
      })
      continue
    }
    if (m.kind === 'level') rowLine(rowOf(m.price), 0x254c, ` ${m.label ? m.label + ' ' : ''}${fmtMark(m.price)} `)
    else if (m.kind === 'zone') {
      rowLine(rowOf(m.price2 ?? m.price), 0x2504, m.label ? ` ${m.label} ` : '')
      rowLine(rowOf(m.price), 0x2504, '')
    } else if (m.t !== undefined) {
      const i = L.shown.findIndex(c => c.t === m.t)
      const c = L.shown[i]
      if (!c) continue
      const y = rowOf(c.h) - 1
      if (put(start + i, y, 0x25bc)) {
        const text = m.label.slice(0, 16)
        label(y - 1, text, start + i - Math.floor(text.length / 2))
      }
    }
  }

  const out: Cell[] = []
  // Legend row: "▪EMA 20 64,210 ▪BB 20 2 64,900/63,300", whole entries only.
  if (plan.legend) {
    const row: Cell[] = Array.from({ length: columns }, (): Cell => [0x20, DEFAULT, DEFAULT])
    let x = 0
    const back = Math.max(0, Math.min(input.cursor, shown - 1))
    for (const s of priceStudies) {
      const color = s.ink ? inkNum(s.ink) : s.kind === 'supertrend' ? inks[4] ?? LABEL : inkOf.get(s.id) ?? LABEL
      const vals = s.series
        .filter(se => se.style !== 'dash')
        .map(se => se.values[se.values.length - 1 - back])
        .filter((v): v is number => v !== null && v !== undefined)
        .map(v => fmtStudy(s, v, fmtPrice))
      const text = `${s.label} ${vals.length > 0 ? vals.join('/') : '…'}`
      if (x + text.length + 1 > columns) break
      row[x] = [0x25aa, color, DEFAULT]
      for (let k = 0; k < text.length; k++) row[x + 1 + k] = [text.charCodeAt(k), k < s.label.length ? LABEL : color, DEFAULT]
      x += text.length + 3
    }
    out.push(...row)
  }
  out.push(...main)
  for (const s of lowers) out.push(...paneCells(s, columns, L.axis, start, shown, input.cursor, (s.ink ? inkNum(s.ink) : inkOf.get(s.id)) ?? LABEL, pal.up, pal.down))
  return out
}

/** One lower pane: a title row with the values, then five rows of line or histogram, its scale on the right. */
function paneCells(s: Study, columns: number, axis: number, start: number, shown: number, cursor: number, ink: number, up: number, down: number): Cell[] {
  const rows = PANE_ROWS - 1
  const cells: Cell[] = Array.from({ length: columns * PANE_ROWS }, (): Cell => [0x20, DEFAULT, DEFAULT])
  const set = (x: number, y: number, c: Cell) => {
    if (x >= 0 && x < columns && y >= 0 && y < PANE_ROWS) cells[y * columns + x] = c
  }
  const back = Math.max(0, Math.min(cursor, shown - 1))
  const at = (se: { values: (number | null)[] }) => se.values[se.values.length - 1 - back]
  // Title row: "─ RSI 14 · 61.2 ─────".
  const vals = s.series
    .map(se => {
      const v = at(se)
      if (v === null || v === undefined) return null
      return s.series.length === 1 ? fmtStudy(s, v, fmtPrice) : `${se.name} ${fmtStudy(s, v, fmtPrice)}`
    })
    .filter((x): x is string => x !== null)
  const title = `─ ${s.label} · ${vals.length > 0 ? vals.join(' · ') : '…'} `
  for (let x = 0; x < columns; x++) set(x, 0, [x < title.length ? title.charCodeAt(x) : 0x2500, x >= 2 + s.label.length && x < title.length ? ink : GRID, DEFAULT])

  let lo = Infinity
  let hi = -Infinity
  for (const se of s.series) for (const v of se.values) if (v !== null && Number.isFinite(v)) {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  if (!Number.isFinite(lo)) return cells
  const fixed = s.scale && Number.isFinite(s.scale.min) ? s.scale : null
  if (fixed) {
    lo = fixed.min
    hi = fixed.max
  } else if (s.kind === 'macd') {
    // The terminal pane draws the histogram alone, so it scales to the histogram.
    let m = 0
    for (const v of s.series[0]?.values ?? []) if (v !== null && Number.isFinite(v)) m = Math.max(m, Math.abs(v))
    lo = -(m || 1)
    hi = m || 1
  } else if (hi === lo) {
    hi += 1
    lo -= 1
  }
  const plotEnd = columns - axis
  const label = (y: number, text: string) => {
    if (axis <= 0) return
    set(plotEnd, y, [0x2502, GRID, DEFAULT])
    for (let k = 0; k < Math.min(text.length, axis - 1); k++) set(plotEnd + 1 + k, y, [text.charCodeAt(k), LABEL, DEFAULT])
  }
  for (let y = 1; y <= rows; y++) set(plotEnd, y, [0x2502, GRID, DEFAULT])

  if (s.kind === 'macd') {
    // Histogram in half blocks either side of the zero line (the middle of the five rows).
    const hist = s.series[0]?.values ?? []
    const halves = rows * 2
    const zero = halves / 2
    hist.forEach((v, i) => {
      if (v === null || v === undefined) return
      const x = start + i
      if (x < 0 || x >= plotEnd) return
      const h = Math.round((Math.abs(v) / hi) * zero)
      for (let k = 0; k < h; k++) {
        const half = v >= 0 ? zero - 1 - k : zero + k
        const y = 1 + Math.floor(half / 2)
        const cur = cells[y * columns + x]
        const isTop = half % 2 === 0
        const glyph = cur && (cur[0] === 0x2580 || cur[0] === 0x2584) ? 0x2588 : isTop ? 0x2580 : 0x2584
        set(x, y, [glyph, v >= 0 ? up : down, DEFAULT])
      }
    })
    label(1, fmtStudy(s, hi, fmtPrice))
    label(rows, fmtStudy(s, lo, fmtPrice))
    return cells
  }

  // A braille line: left dots join from the last point, right dots mark this one.
  const dots = rows * 4
  const yOf = (v: number) => Math.max(0, Math.min(dots - 1, Math.round(((hi - v) / (hi - lo)) * (dots - 1))))
  if (fixed) {
    // The outer guide levels (RSI 70/30, Stoch 80/20) as dotted rows.
    const lv = [...fixed.levels].sort((a, b) => a - b)
    for (const lvl of lv.length >= 2 ? [lv[lv.length - 1] as number, lv[0] as number] : lv) {
      const y = 1 + Math.floor(yOf(lvl) / 4)
      for (let x = 0; x < plotEnd; x++) set(x, y, [0x2508, GRID, DEFAULT])
      label(y, String(lvl))
    }
  } else {
    label(1, fmtStudy(s, hi, fmtPrice))
    label(rows, fmtStudy(s, lo, fmtPrice))
  }
  const bits = new Uint8Array(columns * rows)
  const line = s.series[0]?.values ?? []
  let prev: number | null = null
  line.forEach((v, i) => {
    const x = start + i
    if (v === null || v === undefined || x < 0 || x >= plotEnd) {
      prev = null
      return
    }
    const y = yOf(v)
    const from = prev ?? y
    for (let d = Math.min(from, y); d <= Math.max(from, y); d++) {
      const k = Math.floor(d / 4) * columns + x
      bits[k] = (bits[k] ?? 0) | (LEFT[d % 4] ?? 0)
    }
    const k = Math.floor(y / 4) * columns + x
    bits[k] = (bits[k] ?? 0) | (RIGHT[y % 4] ?? 0)
    prev = y
  })
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < plotEnd; x++) {
      const b = bits[y * columns + x] ?? 0
      if (b !== 0) set(x, y + 1, [0x2800 + b, ink, DEFAULT])
    }
  return cells
}
