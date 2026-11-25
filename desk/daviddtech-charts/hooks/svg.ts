// Desktop, editor and mobile charts as SVG markup (the in-chat chart's math,
// widget.py's fan / oddsChart, as strings). The SVG is isolated and cannot
// read the theme, so colors are mid tones that read on light and dark.
// Every inserted string is XML-escaped; no script, no event attributes.

import type { Chart } from '../types'
import { chance, day, pct } from './model'
import { fanLevels, fanRange } from './raster'

export const MAX_SVG = 131072
const W = 640
const H = 260
const M = { l: 46, r: 124, t: 12, b: 24 }
const IW = W - M.l - M.r
const IH = H - M.t - M.b

const C = {
  text: '#8a94a6',
  band: '#4c8bf5',
  level: '#8a94a6',
}
/** At most 3 odds lines: blue shades told apart by the dash and the label at each line's end. */
export const ODDS = ['#4c8bf5', '#3a6fd0', '#7aa6f7'] as const
const ODDS_DASH = ['', '7 4', '2 3']

const STYLE =
  `text{fill:${C.text};font:11px system-ui,-apple-system,Segoe UI,sans-serif}` +
  `.grid{stroke:${C.text};stroke-opacity:.18}.zero{stroke:${C.text};stroke-opacity:.55}` +
  `.b90{fill:${C.band};fill-opacity:.16}.b50{fill:${C.band};fill-opacity:.30}` +
  `.mid{fill:none;stroke:${C.band};stroke-width:1;stroke-opacity:.6}.tick{stroke:${C.band};stroke-width:2;stroke-opacity:.6}.lvl{stroke-dasharray:4 3;stroke-width:1.2}` +
  `.oline{fill:none;stroke-width:2}.hit:hover{fill:${C.text};fill-opacity:.08}`

/** XML-escapes & < > " ' for text and attribute values. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch] ?? ch)
}

function f(v: number): string {
  return v.toFixed(1)
}

function open(label: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">` +
    `<style>${STYLE}</style>`
  )
}

export function ticks(lo: number, hi: number): { list: number[]; size: number } {
  const raw = (hi - lo) / 4
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)))
  let size = mag
  for (const k of [1, 2, 2.5, 5, 10]) {
    size = k * mag
    if (raw <= size) break
  }
  const list: number[] = []
  for (let t = Math.ceil(lo / size) * size; t <= hi + 1e-9; t += size) list.push(Math.round(t * 1e6) / 1e6)
  return { list, size }
}

function spread(items: { y: number }[], gap: number, min: number, max: number): void {
  items.sort((a, b) => a.y - b.y)
  for (let i = 0; i < items.length; i++) items[i]!.y = Math.max(items[i]!.y, i ? items[i - 1]!.y + gap : min)
  for (let j = items.length - 1; j >= 0; j--) items[j]!.y = Math.min(items[j]!.y, j < items.length - 1 ? items[j + 1]!.y - gap : max)
}

/** Levels are grey; their labels say which is which. Color is kept for the forecast (blue). */
function levelColor(_kind: Chart['levels'][number]['kind']): string {
  return C.level
}

/** The chart for a non-terminal surface, or null when it has none (a card, a plan). */
export function svgFor(chart: Chart): string | null {
  if (chart.kind === 'brief' && chart.path.length >= 2) return fanSvg(chart)
  if (chart.kind === 'odds' && chart.odds.some(o => o.values.length >= 2)) return oddsSvg(chart)
  if (chart.kind === 'scan' && chart.rows.length > 0) return scanSvg(chart)
  return null
}

// ---------------------------------------------------------------- fan

export function fanSvg(chart: Chart): string {
  const path = chart.path
  const n = path.length - 1
  const { lo, hi } = fanRange(chart)
  const X = (i: number) => M.l + (IW * i) / n
  const Y = (v: number) => M.t + (IH * (hi - v)) / (hi - lo)
  const line = (k: 'p10' | 'p25' | 'p50' | 'p75' | 'p90') =>
    path.map((p, i) => `${i ? 'L' : 'M'}${f(X(i))} ${f(Y(p[k]))}`).join(' ')
  const area = (up: 'p90' | 'p75', down: 'p10' | 'p25') =>
    `${line(up)} ${path.slice().reverse().map((p, k) => `L${f(X(n - k))} ${f(Y(p[down]))}`).join(' ')} Z`
  const parts: string[] = [open(`${chart.symbol} forecast range, next ${n} steps`)]
  const tk = ticks(lo, hi)
  const dec = tk.size < 1 ? 1 : 0
  for (const t of tk.list) {
    parts.push(`<line class="grid" x1="${M.l}" x2="${M.l + IW}" y1="${f(Y(t))}" y2="${f(Y(t))}"/>`)
    parts.push(`<text x="${M.l - 6}" y="${f(Y(t) + 4)}" text-anchor="end">${esc(pct(t, dec))}</text>`)
  }
  parts.push(`<line class="zero" x1="${M.l}" x2="${M.l + IW}" y1="${f(Y(0))}" y2="${f(Y(0))}"/>`)
  parts.push(`<path class="b90" d="${area('p90', 'p10')}"/>`)
  parts.push(`<path class="b50" d="${area('p75', 'p25')}"/>`)
  parts.push(`<path class="mid" d="${line('p50')}"/>`)
  const levels = fanLevels(chart)
  const labels = levels.map(l => {
    const y = Y(l.pct)
    parts.push(`<line class="lvl" stroke="${levelColor(l.kind)}" x1="${M.l}" x2="${M.l + IW}" y1="${f(y)}" y2="${f(y)}"/>`)
    return { y, l }
  })
  spread(labels, 13, M.t + 4, M.t + IH)
  for (const it of labels) {
    const touch = it.l.touch === null ? '' : ` · touch ${chance(it.l.touch)}`
    parts.push(`<text x="${M.l + IW + 6}" y="${f(it.y + 4)}" style="fill:${levelColor(it.l.kind)}">${esc(pct(it.l.pct) + touch)}</text>`)
  }
  const marks: [number, string][] = [[0, 'start'], [n, 'end']]
  if (n >= 4) marks.push([Math.round(n / 2), 'middle'])
  for (const [i, anchor] of marks) {
    parts.push(`<text x="${f(X(i))}" y="${H - 6}" text-anchor="${anchor}">${esc(day(path[i]?.session ?? null))}</text>`)
  }
  path.forEach((p, i) => {
    const w = IW / n
    const x = Math.max(M.l, X(i) - w / 2)
    const width = Math.min(M.l + IW, X(i) + w / 2) - x
    const tip = i === 0
      ? `${day(p.session)} close: the starting point (0%)`
      : `${day(p.session)} (step ${i}): 80% range ${pct(p.p10)} to ${pct(p.p90)} · middle ${pct(p.p50)} · chance higher ${chance(p.probUp)}`
    parts.push(`<rect class="hit" x="${f(x)}" y="${M.t}" width="${f(width)}" height="${IH}" fill="transparent"><title>${esc(tip)}</title></rect>`)
  })
  parts.push('</svg>')
  return parts.join('')
}

// ---------------------------------------------------------------- odds

export function oddsSvg(chart: Chart): string {
  const lines = chart.odds.slice(0, ODDS.length)
  const n = Math.max(1, ...lines.map(l => l.values.length - 1))
  const X = (i: number) => M.l + (IW * i) / n
  const Y = (p: number) => M.t + IH * (1 - p)
  const parts: string[] = [open(`${chart.symbol} touch chance by day for ${lines.length} levels`)]
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    parts.push(`<line class="grid" x1="${M.l}" x2="${M.l + IW}" y1="${f(Y(t))}" y2="${f(Y(t))}"/>`)
    parts.push(`<text x="${M.l - 6}" y="${f(Y(t) + 4)}" text-anchor="end">${Math.round(t * 100)}%</text>`)
  }
  const labels = lines.map((line, j) => {
    const d = line.values.map((v, i) => `${i ? 'L' : 'M'}${f(X(i))} ${f(Y(v))}`).join(' ')
    const dash = ODDS_DASH[j] ? ` stroke-dasharray="${ODDS_DASH[j]}"` : ''
    parts.push(`<path class="oline" stroke="${ODDS[j] ?? C.level}"${dash} d="${d}"/>`)
    const last = chart.levels[j]?.touch ?? line.values[line.values.length - 1] ?? 0
    return { y: Y(line.values[line.values.length - 1] ?? 0), j, text: `${line.name} · ${chance(last)}` }
  })
  spread(labels, 13, M.t + 4, M.t + IH)
  for (const it of labels) {
    parts.push(`<text x="${M.l + IW + 6}" y="${f(it.y + 4)}" style="fill:${ODDS[it.j] ?? C.level}">${esc(it.text)}</text>`)
  }
  parts.push(`<text x="${M.l}" y="${H - 6}" text-anchor="start">${esc(chart.fromLabel ?? day(chart.asOf))}</text>`)
  parts.push(`<text x="${M.l + IW}" y="${H - 6}" text-anchor="end">${esc(chart.endLabel ?? day(chart.endDate))}</text>`)
  for (let i = 1; i <= n; i++) {
    const tip = `step ${i}: touched by then ${lines.map(l => `${l.name} ${chance(l.values[i] ?? 0)}`).join(', ')}`
    parts.push(`<rect class="hit" x="${f(X(i - 0.5))}" y="${M.t}" width="${f(IW / n)}" height="${IH}" fill="transparent"><title>${esc(tip)}</title></rect>`)
  }
  parts.push('</svg>')
  return parts.join('')
}

// ---------------------------------------------------------------- scan

export function scanSvg(chart: Chart): string {
  const rows = chart.rows.slice(0, 12)
  let lo = 0
  let hi = 0
  for (const r of rows) {
    lo = Math.min(lo, r.range80[0])
    hi = Math.max(hi, r.range80[1])
  }
  const pad = (hi - lo) * 0.05 || 0.5
  lo -= pad
  hi += pad
  const left = 80
  const right = W - 120
  const X = (v: number) => left + ((right - left) * (v - lo)) / (hi - lo)
  const rh = Math.min(28, IH / Math.max(1, rows.length))
  const parts: string[] = [open(`80% ranges of ${rows.length} symbols, ${chart.steps} steps ahead`)]
  parts.push(`<line class="zero" x1="${f(X(0))}" x2="${f(X(0))}" y1="${M.t}" y2="${f(M.t + rh * rows.length)}"/>`)
  rows.forEach((r, i) => {
    const y = M.t + rh * i + rh / 2
    const tip = `${r.symbol}: 80% range ${pct(r.range80[0])} to ${pct(r.range80[1])} · middle ${pct(r.middle)}${r.storm === null ? '' : ` · storm ${r.storm}`}`
    parts.push(`<g><title>${esc(tip)}</title>`)
    parts.push(`<text x="${left - 8}" y="${f(y + 4)}" text-anchor="end">${esc(r.symbol)}</text>`)
    parts.push(`<rect class="b50" x="${f(X(r.range80[0]))}" y="${f(y - rh * 0.3)}" width="${f(X(r.range80[1]) - X(r.range80[0]))}" height="${f(rh * 0.6)}" rx="3"/>`)
    parts.push(`<line class="tick" x1="${f(X(r.middle))}" x2="${f(X(r.middle))}" y1="${f(y - rh * 0.36)}" y2="${f(y + rh * 0.36)}"/>`)
    parts.push(`<text x="${right + 8}" y="${f(y + 4)}">${esc(`${pct(r.range80[0])} to ${pct(r.range80[1])}`)}</text></g>`)
  })
  parts.push('</svg>')
  return parts.join('')
}
