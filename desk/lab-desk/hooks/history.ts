// The history lab: questions about the past, asked of up to 5000 closed candles on the member's own PC.
// "What happened after X" (an event study) and "moments like now" (the closest look-alike stretches).
// Every answer says how many cases it stands on, a range instead of one number, and how any candle did.
// Pure: no `$`.

import type { Candle } from '../types'
import { evalFormula } from './formula'
import { parseScan, scanWarmup } from './scan'
import type { Scan } from './scan'

/** Under this many cases there are no numbers, only the dates. */
export const MIN_CASES = 10
/** Under this many, the numbers come with a plain "few cases" line. */
export const FEW_CASES = 30
export const AHEAD_DEFAULT = 10
export const AHEAD_MAX = 200
export const LIKE_WINDOW = 20
export const LIKE_COUNT = 10

/** One or more scan conditions joined by "and", with the interval from any "on 4h". */
export type Condition = { parts: Scan[]; text: string; interval: string | null; /** The person's own words, without the interval. */ said: string }

export function parseCondition(raw: string): Condition | { error: string } {
  let text = raw.trim()
  let interval: string | null = null
  const iv = /\s+(?:on\s+)?(1m|5m|15m|1h|4h|1d|1w)\s*$/i.exec(text)
  if (iv) {
    interval = (iv[1] ?? '').toLowerCase()
    text = text.slice(0, iv.index)
  }
  const pieces = text.split(/\s+and\s+/i).map(x => x.trim()).filter(x => x !== '')
  if (pieces.length === 0) return { error: 'Say a condition, e.g. "rsi < 30", "close crosses above ema 200", or two joined by "and".' }
  if (pieces.length > 4) return { error: 'Up to 4 parts joined by "and".' }
  const parts: Scan[] = []
  for (const p of pieces) {
    const s = parseScan(p)
    if ('error' in s) return { error: s.error.replace(/\/lab-scan /g, '') }
    parts.push(s)
  }
  return { parts, text: parts.map(p => (p.name ? `${p.name} (${p.text})` : p.text)).join(' and '), interval, said: pieces.join(' and ') }
}

export function conditionWarmup(c: Condition): number {
  return Math.max(0, ...c.parts.map(scanWarmup))
}

/** The condition on every candle: true, false, or null while a side is still warming up. */
export function conditionSeries(c: Condition, candles: readonly Candle[]): (boolean | null)[] {
  const each = c.parts.map(p => {
    const a = evalFormula(p.left, candles)
    const b = evalFormula(p.right, candles)
    return candles.map((_, i): boolean | null => {
      const x = a[i]
      const y = b[i]
      if (x === null || x === undefined || y === null || y === undefined) return null
      switch (p.op) {
        case '<':
          return x < y
        case '>':
          return x > y
        case '<=':
          return x <= y
        case '>=':
          return x >= y
        default: {
          const px = a[i - 1]
          const py = b[i - 1]
          if (px === null || px === undefined || py === null || py === undefined) return null
          return p.op === 'crosses above' ? px <= py && x > y : px >= py && x < y
        }
      }
    })
  })
  return candles.map((_, i) => {
    let out: boolean | null = true
    for (const s of each) {
      const v = s[i] ?? null
      if (v === null) return null
      if (!v) out = false
    }
    return out
  })
}

// Small statistics, written out so a member's AI can check them.

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const a = sorted[lo] as number
  const b = sorted[hi] as number
  return a + (b - a) * (pos - lo)
}

/** Wilson's 95% range for a share k of n: honest at small n, never outside 0..1. */
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1]
  const z = 1.96
  const p = k / n
  const d = 1 + (z * z) / n
  const mid = (p + (z * z) / (2 * n)) / d
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return [Math.max(0, mid - half), Math.min(1, mid + half)]
}

export type Spread = { n: number; median: number; p25: number; p75: number; up: number; upLo: number; upHi: number; mean: number }

/** Median, middle half and share up (with its 95% range) of returns. */
export function spread(returns: readonly number[]): Spread {
  const s = [...returns].sort((a, b) => a - b)
  const up = s.filter(x => x > 0).length
  const [lo, hi] = wilson(up, s.length)
  return { n: s.length, median: quantile(s, 0.5), p25: quantile(s, 0.25), p75: quantile(s, 0.75), up: s.length ? up / s.length : NaN, upLo: lo, upHi: hi, mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN }
}

/** Return over `ahead` candles from every candle where that is known: the "any candle" yardstick. */
export function baseReturns(candles: readonly Candle[], ahead: number, from = 0): number[] {
  const out: number[] = []
  for (let i = from; i + ahead < candles.length; i++) {
    const a = (candles[i] as Candle).c
    if (a > 0) out.push((candles[i + ahead] as Candle).c / a - 1)
  }
  return out
}

export type Case = { i: number; t: number; ret: number; worst: number; best: number }

export type After = {
  cases: Case[]
  /** Times the condition turned true but the look-ahead ran past the data (the latest ones). */
  open: number[]
  stats: Spread | null
  base: Spread
  halves: [Spread, Spread] | null
  from: number
  to: number
}

/**
 * What happened after the condition turned true: the first candle of each run, entered at its close, each case at
 * least `ahead` candles after the one before so no candle counts twice; the move `ahead` candles later, and the
 * worst dip and best run inside that window (from lows and highs). The last candle given must be closed.
 */
export function afterStudy(c: Condition, candles: readonly Candle[], ahead: number): After {
  const on = conditionSeries(c, candles)
  const cases: Case[] = []
  const open: number[] = []
  let next = 0
  for (let i = 1; i < candles.length; i++) {
    if (on[i] !== true || on[i - 1] === true || i < next) continue
    const k = candles[i] as Candle
    if (i + ahead >= candles.length) {
      open.push(k.t)
      continue
    }
    let lo = Infinity
    let hi = -Infinity
    for (let j = i + 1; j <= i + ahead; j++) {
      lo = Math.min(lo, (candles[j] as Candle).l)
      hi = Math.max(hi, (candles[j] as Candle).h)
    }
    cases.push({ i, t: k.t, ret: (candles[i + ahead] as Candle).c / k.c - 1, worst: lo / k.c - 1, best: hi / k.c - 1 })
    next = i + ahead
  }
  const warm = conditionWarmup(c)
  const stats = cases.length >= MIN_CASES ? spread(cases.map(x => x.ret)) : null
  const half = Math.floor(cases.length / 2)
  const halves: [Spread, Spread] | null = cases.length >= 2 * MIN_CASES ? [spread(cases.slice(0, half).map(x => x.ret)), spread(cases.slice(half).map(x => x.ret))] : null
  return { cases, open, stats, base: spread(baseReturns(candles, ahead, warm)), halves, from: (candles[Math.min(warm, candles.length - 1)] as Candle | undefined)?.t ?? 0, to: candles.at(-1)?.t ?? 0 }
}

export type Like = { i: number; t: number; likeness: number; path: number[] }

export type LikeNow = { matches: Like[]; stats: Spread | null; base: Spread; window: number; ahead: number; median: number[] }

/** z-scores of closes: the shape of a stretch, apart from its price level and size. */
function shape(candles: readonly Candle[], end: number, n: number): number[] | null {
  if (end - n + 1 < 0) return null
  const xs = candles.slice(end - n + 1, end + 1).map(k => k.c)
  const m = xs.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / n)
  return sd > 0 ? xs.map(x => (x - m) / sd) : null
}

/**
 * Moments like now: the past stretches of `window` closes shaped most like the last one (correlation of their
 * z-scores, 1 is the same shape), none overlapping another or now, and the path each took over the next `ahead`
 * candles in %. The last candle given must be closed.
 */
export function likeNow(candles: readonly Candle[], window = LIKE_WINDOW, ahead = AHEAD_DEFAULT, count = LIKE_COUNT): LikeNow {
  const last = candles.length - 1
  const now = shape(candles, last, window)
  const tried: { end: number; r: number }[] = []
  if (now) {
    // A look-alike and the path after it both end before the current stretch starts.
    for (let end = window - 1; end + ahead < last - window + 1; end++) {
      const s = shape(candles, end, window)
      if (!s) continue
      let dot = 0
      for (let k = 0; k < window; k++) dot += (s[k] as number) * (now[k] as number)
      tried.push({ end, r: dot / window })
    }
  }
  tried.sort((a, b) => b.r - a.r)
  const picked: { end: number; r: number }[] = []
  for (const x of tried) {
    if (picked.length >= count) break
    if (picked.some(p => Math.abs(p.end - x.end) < window)) continue
    picked.push(x)
  }
  const matches = picked.map(({ end, r }): Like => {
    const base = (candles[end] as Candle).c
    return { i: end, t: (candles[end] as Candle).t, likeness: r, path: Array.from({ length: ahead }, (_, s) => (candles[end + s + 1] as Candle).c / base - 1) }
  })
  const ends = matches.map(m => m.path[ahead - 1] as number)
  const median = Array.from({ length: ahead }, (_, s) => quantile(matches.map(m => m.path[s] as number).sort((a, b) => a - b), 0.5))
  return { matches, stats: matches.length >= MIN_CASES ? spread(ends) : null, base: spread(baseReturns(candles, ahead, window)), window, ahead, median }
}

// Words.

export const pct = (x: number, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%` : 'n/a')
const share = (x: number) => `${Math.round(x * 100)}%`
export const day = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ')

/** Whether the share-up range clears the any-candle share: the plain-words verdict. */
export function verdict(s: Spread, base: Spread): string {
  if (s.upLo > base.up) return `Its up-share range (${share(s.upLo)}–${share(s.upHi)}) sits above any candle's ${share(base.up)}: a real lean in this history, not proof it repeats.`
  if (s.upHi < base.up) return `Its up-share range (${share(s.upLo)}–${share(s.upHi)}) sits below any candle's ${share(base.up)}: a real lean down in this history, not proof it repeats.`
  return `Its up-share range (${share(s.upLo)}–${share(s.upHi)}) takes in any candle's ${share(base.up)}, so this could be plain chance.`
}

export function spreadLine(s: Spread): string {
  return `median ${pct(s.median)}, middle half ${pct(s.p25)} to ${pct(s.p75)}, up ${share(s.up)} of the time (95% range ${share(s.upLo)}–${share(s.upHi)})`
}

export function afterText(c: Condition, coin: string, interval: string, ahead: number, a: After, onChart: number): string {
  const lines = [`History: ${coin} ${interval}, ${c.said}, then ${ahead} candle${ahead === 1 ? '' : 's'} on. ${a.cases.length} case${a.cases.length === 1 ? '' : 's'} from ${day(a.from)} to ${day(a.to)} UTC (first candle of each run, at its close, cases at least ${ahead} candles apart).`]
  if (a.stats) {
    lines.push(`After: ${spreadLine(a.stats)}. Worst dip inside the window: median ${pct(quantile(a.cases.map(x => x.worst).sort((p, q) => p - q), 0.5))}; best run: median ${pct(quantile(a.cases.map(x => x.best).sort((p, q) => p - q), 0.5))}.`)
    lines.push(`Any candle, ${ahead} on: median ${pct(a.base.median)}, up ${share(a.base.up)} of the time.`)
    lines.push(verdict(a.stats, a.base))
    if (a.halves) lines.push(`First half of the cases: median ${pct(a.halves[0].median)}, up ${share(a.halves[0].up)}; second half: median ${pct(a.halves[1].median)}, up ${share(a.halves[1].up)}${Math.sign(a.halves[0].median) !== Math.sign(a.halves[1].median) ? ' (the two halves disagree)' : ''}.`)
    if (a.cases.length < FEW_CASES) lines.push(`Only ${a.cases.length} cases: read it as a hint, not a rule.`)
  } else {
    lines.push(`Under ${MIN_CASES} cases, so no numbers: that would be guessing. A longer interval, a looser condition or fewer candles ahead gives more cases.`)
  }
  if (a.cases.length > 0) lines.push(`Latest cases: ${a.cases.slice(-6).map(x => `${day(x.t)} ${pct(x.ret, 1)}`).join(' · ')}.`)
  if (a.open.length > 0) lines.push(`Still open (not ${ahead} candles old yet): ${a.open.slice(-3).map(day).join(', ')}.`)
  if (onChart > 0) lines.push(`${onChart} case${onChart === 1 ? '' : 's'} pinned on the chart (layer "cases").`)
  return lines.join('\n')
}

export function likeText(coin: string, interval: string, l: LikeNow, onChart: number, isDrawn = false): string {
  const lines = [`Moments like now: ${coin} ${interval}, the last ${l.window} closes against every earlier stretch; the ${l.matches.length} closest shapes, none overlapping.`]
  if (l.matches.length === 0) return `${lines[0]}\nNot enough history for this interval.`
  const avg = l.matches.reduce((a, m) => a + m.likeness, 0) / l.matches.length
  lines.push(`Likeness ${avg.toFixed(2)} on average (1 is the same shape). Dates: ${l.matches.map(m => `${day(m.t)} ${pct(m.path[l.ahead - 1] as number, 1)}`).join(' · ')}.`)
  if (l.stats) {
    lines.push(`${l.ahead} candles after them: ${spreadLine(l.stats)}.`)
    lines.push(`Any candle, ${l.ahead} on: median ${pct(l.base.median)}, up ${share(l.base.up)} of the time.`)
    lines.push(`${verdict(l.stats, l.base)} ${l.matches.length} look-alikes is a small sample; similar shapes do not make the same future.`)
  }
  if (isDrawn)
    lines.push(`On the chart (layer "like now"): what came after each, drawn to the right of the last candle, the middle path in bold${onChart > 0 ? `; ${onChart} of the look-alikes also pinned on the candles shown` : ''}. The DaviddTech+ range takes that spot when it shows.`)
  else if (onChart > 0) lines.push(`${onChart} of them pinned on the chart (layer "like now").`)
  return lines.join('\n')
}
