// Scan: one condition over the watchlist, on the latest candle, like a small TradingView screener.
// "rsi < 30", "close > ema 200", "ema 20 crosses above ema 50". Each side is a formula (Pine) or a short word.
// Pure: no `$`.

import type { Candle } from '../types'
import type { Node } from './formula'
import { evalFormula, formulaWarmup, parseFormula, printFormula } from './formula'

export type ScanOp = '<' | '>' | '<=' | '>=' | 'crosses above' | 'crosses below'
export type Scan = { left: Node; op: ScanOp; right: Node; text: string; interval: string | null; name?: string }

/** At most this many coins per scan, one request each, one after another. */
export const SCAN_MAX = 6
export const SCAN_EXAMPLES = ['rsi < 30', 'close > ema 200', 'ema 20 crosses above ema 50', 'rsi 14 > 70 on 4h']

/** Scans by name, for people who don't want to write one: the words most traders use, as the condition they mean. */
export const NAMED_SCANS: Readonly<Record<string, string>> = {
  oversold: 'rsi < 30',
  overbought: 'rsi > 70',
  uptrend: 'close > ema 200',
  downtrend: 'close < ema 200',
  'golden cross': 'sma 50 crosses above sma 200',
  'death cross': 'sma 50 crosses below sma 200',
}

/** "oversold on 4h" → "rsi < 30 on 4h"; anything else as it is. */
export function expandNamed(text: string): string {
  const m = /^\s*([a-z ]+?)(\s+(?:on\s+)?(?:1m|5m|15m|1h|4h|1d|1w))?\s*$/i.exec(text)
  const named = m ? NAMED_SCANS[(m[1] ?? '').toLowerCase().replace(/\s+/g, ' ')] : undefined
  return named ? `${named}${m?.[2] ?? ''}` : text
}

/** Short words people type, as Pine: "rsi" → ta.rsi(close, 14), "ema 50" → ta.ema(close, 50), "cci" → ta.cci(hlc3, 20), "price" → close. */
export function expandWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/(?<![.\w])price\b/g, 'close')
    .replace(/(?<![.\w])(ema|sma|hma|wma|rma|vwma)\s+(\d+)\b(?!\s*\()/g, 'ta.$1(close, $2)')
    .replace(/(?<![.\w])cci(?:\s+(\d+))?\b(?!\s*\()/g, (_, n: string | undefined) => `ta.cci(hlc3, ${n ?? 20})`)
    .replace(/(?<![.\w])roc(?:\s+(\d+))?\b(?!\s*\()/g, (_, n: string | undefined) => `ta.roc(close, ${n ?? 9})`)
    .replace(/(?<![.\w])mom(?:\s+(\d+))?\b(?!\s*\()/g, (_, n: string | undefined) => `ta.mom(close, ${n ?? 10})`)
    .replace(/(?<![.\w])rsi(?:\s+(\d+))?\b(?!\s*\()/g, (_, n: string | undefined) => `ta.rsi(close, ${n ?? 14})`)
    .replace(/(?<![.\w])atr(?:\s+(\d+))?\b(?!\s*\()/g, (_, n: string | undefined) => `ta.atr(${n ?? 14})`)
}

/** "rsi < 30 on 4h" → the two sides, the comparison and the interval; or a plain error. */
export function parseScan(raw: string, opts: { funding?: boolean } = {}): Scan | { error: string } {
  // In the history lab, "funding > 20%" reads as %/yr, the way the status line shows it.
  const said = opts.funding ? raw.replace(/(\d)\s*%/g, '$1') : raw
  const expanded = expandNamed(said)
  const name = expanded !== said ? said.trim().toLowerCase().replace(/\s+(?:on\s+)?(?:1m|5m|15m|1h|4h|1d|1w)$/, '').replace(/\s+/g, ' ') : undefined
  let text = expanded.trim()
  const usage = `Try: ${SCAN_EXAMPLES.map(x => `/lab-scan ${x}`).join(' · ')} · or by name: ${Object.keys(NAMED_SCANS).join(', ')}`
  if (text === '') return { error: usage }
  let interval: string | null = null
  const iv = /\s+(?:on\s+)?(1m|5m|15m|1h|4h|1d|1w)\s*$/i.exec(text)
  if (iv) {
    interval = (iv[1] ?? '').toLowerCase()
    text = text.slice(0, iv.index)
  }
  const m = /\s+crosses\s+(above|below)\s+|\s*(<=|>=|<|>)\s*/i.exec(text)
  if (!m) return { error: `Compare two things with <, >, <=, >= or "crosses above/below". ${usage}` }
  const op = (m[1] ? `crosses ${m[1].toLowerCase()}` : m[2]) as ScanOp
  const sides = [text.slice(0, m.index), text.slice(m.index + m[0].length)]
  const nodes: Node[] = []
  for (const side of sides) {
    const n = parseFormula(expandWords(side), { allowConst: true, allowFunding: opts.funding === true })
    if ('error' in n) return { error: `${n.error.replace(/^Formula: /, 'Scan: ')}` }
    nodes.push(n)
  }
  const [left, right] = nodes as [Node, Node]
  if (left.t === 'num' && right.t === 'num') return { error: `Scan: one side needs a series, e.g. rsi or close. ${usage}` }
  return { left, op, right, text: `${printFormula(left)} ${op} ${printFormula(right)}`, interval, ...(name ? { name } : {}) }
}

/** How many candles a scan wants so both sides have settled. */
export function scanWarmup(scan: Scan): number {
  return Math.max(formulaWarmup(scan.left), formulaWarmup(scan.right))
}

export type ScanHit = { match: boolean; left: number; right: number } | null

/** The scan on the latest candle (and the one before for a cross); null while a side is still warming up. */
export function scanCandles(scan: Scan, candles: readonly Candle[]): ScanHit {
  const a = evalFormula(scan.left, candles)
  const b = evalFormula(scan.right, candles)
  const i = candles.length - 1
  const [x, y, px, py] = [a[i], b[i], a[i - 1], b[i - 1]]
  if (x === null || x === undefined || y === null || y === undefined) return null
  switch (scan.op) {
    case '<':
      return { match: x < y, left: x, right: y }
    case '>':
      return { match: x > y, left: x, right: y }
    case '<=':
      return { match: x <= y, left: x, right: y }
    case '>=':
      return { match: x >= y, left: x, right: y }
    case 'crosses above':
    case 'crosses below': {
      if (px === null || px === undefined || py === null || py === undefined) return null
      const up = scan.op === 'crosses above'
      return { match: up ? px <= py && x > y : px >= py && x < y, left: x, right: y }
    }
  }
}

/** A value in a few characters: prices with separators, small numbers with two decimals. */
export function fmtScan(n: number): string {
  const a = Math.abs(n)
  if (a >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (a >= 1) return n.toFixed(2)
  return n.toPrecision(3)
}

/** The answer: matches first, then the rest with their numbers, then a next step. */
export function scanText(scan: Scan, interval: string, rows: readonly { coin: string; hit: ScanHit | 'error' }[]): string {
  const yes = rows.filter(r => r.hit !== 'error' && r.hit?.match)
  const no = rows.filter(r => r.hit !== 'error' && r.hit && !r.hit.match)
  const odd = rows.filter(r => r.hit === 'error' || r.hit === null)
  const nums = (r: { hit: ScanHit | 'error' }) => (r.hit && r.hit !== 'error' ? `${fmtScan(r.hit.left)} vs ${fmtScan(r.hit.right)}` : '')
  const lines = [`Scan: ${scan.name ? `${scan.name} (${scan.text})` : scan.text} on ${interval}, latest candle, ${rows.length} coin${rows.length === 1 ? '' : 's'}.`]
  lines.push(yes.length > 0 ? `Matches: ${yes.map(r => `${r.coin} (${nums(r)})`).join(', ')}.` : 'No matches right now.')
  if (no.length > 0) lines.push(`Not now: ${no.map(r => `${r.coin} (${nums(r)})`).join(', ')}.`)
  if (odd.length > 0) lines.push(`No answer for: ${odd.map(r => `${r.coin} (${r.hit === 'error' ? 'no candles' : 'not enough candles'})`).join(', ')}.`)
  const first = yes[0]?.coin ?? no[0]?.coin
  lines.push(first ? `Next: /lab-chart ${first} ${interval} opens it, or /lab-watch changes the coins scanned.` : 'Next: /lab-watch picks the coins to scan.')
  return lines.join('\n')
}
