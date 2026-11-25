// Levels, zones, notes, trend lines and Fibonacci retracements on the chart: what /lab-mark and Claude's chart
// tool draw. Pure: no `$`.

import type { Candle, Mark } from '../types'
import { fmtPrice } from './data'

/** At most this many marks per coin; the oldest go first. */
export const MAX_MARKS = 12
const MAX_LABEL = 40

/** "65000", "65k", "1.2m", "64,500" → a number, or null. */
export function priceOf(word: string): number | null {
  const m = /^(-?[\d,]*\.?\d+)([km]?)$/i.exec(word.trim())
  if (!m) return null
  const n = Number((m[1] ?? '').replace(/,/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = (m[2] ?? '').toLowerCase()
  return unit === 'k' ? n * 1e3 : unit === 'm' ? n * 1e6 : n
}

/** A mark's price as typed: 65000 → "65,000", 0.0125 stays; other prices as the chart shows them. */
export function fmtMark(p: number): string {
  return Number.isInteger(p) ? String(p).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : fmtPrice(p)
}

function cleanLabel(s: string): string {
  return s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, MAX_LABEL)
}

/** TradingView's default retracement levels. */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const

/** Each fib level's price: 0 at the end, 1 at the start, as TradingView draws a retracement from start to end. */
export function fibPrices(m: Mark): { r: number; price: number }[] {
  const from = m.price
  const to = m.price2 ?? m.price
  return FIB_LEVELS.map(r => ({ r, price: to + (from - to) * r }))
}

/** A trend line's price at time `t`: straight through its two points, in time (markets that never close). */
export function trendAt(m: Mark, t: number): number | null {
  if (m.t === undefined || m.t2 === undefined || m.price2 === undefined || m.t2 === m.t) return null
  return m.price + ((m.price2 - m.price) * (t - m.t)) / (m.t2 - m.t)
}

/** How far back the automatic trend line and fib look: about one screen of candles. */
const AUTO_SPAN = 120

/**
 * Swing lows (or highs) as ta.pivotlow(span, span) finds them: a candle whose low is below the `span` candles
 * before it and not above the `span` after it. Indexes in order.
 */
export function swings(c: readonly Candle[], side: 'low' | 'high', span = 5): number[] {
  const out: number[] = []
  const v = (k: Candle) => (side === 'low' ? k.l : -k.h)
  for (let i = span; i < c.length - span; i++) {
    const here = v(c[i] as Candle)
    let ok = true
    for (let k = i - span; k < i && ok; k++) if (v(c[k] as Candle) <= here) ok = false
    for (let k = i + 1; k <= i + span && ok; k++) if (v(c[k] as Candle) < here) ok = false
    if (ok) out.push(i)
  }
  return out
}

/** The trend line through the last two swing lows (or highs) of the recent candles, or null when there are fewer. */
export function autoTrend(coin: string, candles: readonly Candle[], side: 'low' | 'high'): Mark | null {
  const c = candles.slice(-AUTO_SPAN)
  const s = swings(c, side)
  const i1 = s[s.length - 2]
  const i2 = s[s.length - 1]
  if (i1 === undefined || i2 === undefined) return null
  const a = c[i1] as Candle
  const b = c[i2] as Candle
  const p = (k: Candle) => (side === 'low' ? k.l : k.h)
  return { coin, kind: 'trend', price: p(a), t: a.t, price2: p(b), t2: b.t, label: side === 'low' ? 'lows' : 'highs' }
}

/** A retracement over the recent swing: from the low to the high when the high came last, else high to low. */
export function autoFib(coin: string, candles: readonly Candle[]): Mark | null {
  const c = candles.slice(-AUTO_SPAN)
  if (c.length < 2) return null
  let hi = 0
  let lo = 0
  c.forEach((k, i) => {
    if (k.h > (c[hi] as Candle).h) hi = i
    if (k.l < (c[lo] as Candle).l) lo = i
  })
  const H = (c[hi] as Candle).h
  const L = (c[lo] as Candle).l
  if (H === L) return null
  return hi > lo ? { coin, kind: 'fib', price: L, price2: H, label: 'fib' } : { coin, kind: 'fib', price: H, price2: L, label: 'fib' }
}

/**
 * /lab-mark's words: "65000 resistance" is a level, "58000 60000 demand" a zone, "fib 58000 65000" a retracement
 * (or "fib" alone over the recent swing), "trend lows" / "trend highs" the line through the last two swings.
 * Anything else gives an error that shows the forms.
 */
export function parseMark(coin: string, text: string, candles: readonly Candle[] = []): Mark | { error: string } {
  const words = text.trim().split(/\s+/).filter(w => w !== '')
  const head = (words[0] ?? '').toLowerCase()
  if (head === 'fib' || head === 'fibo' || head === 'fibonacci') {
    const from = priceOf(words[1] ?? '')
    const to = priceOf(words[2] ?? '')
    if (from !== null && to !== null && from !== to) return { coin, kind: 'fib', price: from, price2: to, label: cleanLabel(words.slice(3).join(' ')) || 'fib' }
    if (words.length > 1) return { error: 'Fib: two prices, start then end: /lab-mark fib 58000 65000, or /lab-mark fib for the recent swing.' }
    return autoFib(coin, candles) ?? { error: 'Not enough candles for a fib yet; try again when the chart has loaded.' }
  }
  if (head === 'trend' || head === 'trendline') {
    const side = /^(highs?|top|tops|resistance)$/i.test(words[1] ?? '') ? 'high' : 'low'
    return autoTrend(coin, candles, side) ?? { error: `No two swing ${side}s in the recent candles yet; try a longer interval.` }
  }
  const a = priceOf(words[0] ?? '')
  if (a === null)
    return { error: 'Give a price first: /lab-mark 65000 resistance, two prices for a zone: /lab-mark 58000 60000 demand, or /lab-mark fib, /lab-mark trend lows.' }
  const b = priceOf(words[1] ?? '')
  if (b !== null) return { coin, kind: 'zone', price: Math.min(a, b), price2: Math.max(a, b), label: cleanLabel(words.slice(2).join(' ')) }
  return { coin, kind: 'level', price: a, label: cleanLabel(words.slice(1).join(' ')) }
}

/** The candle that holds a time given as ms or ISO text (UTC when no zone is written), or undefined. */
function candleAt(raw: unknown, candles: readonly Candle[]): Candle | undefined {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined
  const t = typeof raw === 'number' ? raw : Date.parse(raw.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(raw) ? raw : raw + 'Z')
  if (!Number.isFinite(t)) return undefined
  let k: Candle | undefined
  for (const c of candles) if (c.t <= t) k = c
  return k
}

/**
 * What Claude's chart tool sends: { kind?, price, to?, label?, time?, time2?, swing? } → a mark, or null when it
 * does not fit. kind "fib" takes price → to (or the recent swing without them); kind "trend" takes two points
 * (time, price) and (time2, to), or swing "lows" / "highs" for the line through the last two swings.
 */
export function markFrom(coin: string, raw: unknown, candles: readonly Candle[]): Mark | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : typeof v === 'string' ? priceOf(v) : null)
  const price = num(o.price)
  const to = num(o.to)
  const label = typeof o.label === 'string' ? cleanLabel(o.label) : ''
  if (o.kind === 'fib') {
    if (price !== null && to !== null && price !== to) return { coin, kind: 'fib', price, price2: to, label: label || 'fib' }
    const auto = autoFib(coin, candles)
    return auto ? { ...auto, label: label || auto.label } : null
  }
  if (o.kind === 'trend') {
    if (o.swing === 'lows' || o.swing === 'highs') {
      const auto = autoTrend(coin, candles, o.swing === 'highs' ? 'high' : 'low')
      return auto ? { ...auto, label: label || auto.label } : null
    }
    const a = candleAt(o.time, candles)
    const b = candleAt(o.time2, candles)
    if (!a || !b || a.t === b.t || price === null || to === null) return null
    const [p, q] = a.t < b.t ? [[a, price], [b, to]] as const : [[b, to], [a, price]] as const
    return { coin, kind: 'trend', price: p[1], t: p[0].t, price2: q[1], t2: q[0].t, label }
  }
  if (o.time !== undefined) {
    // The note sits on the candle that holds that time.
    const k = candleAt(o.time, candles)
    if (!k) return null
    return { coin, kind: 'note', price: price ?? k.h, t: k.t, label: label || 'note' }
  }
  if (price === null) return null
  if (to !== null && to !== price) return { coin, kind: 'zone', price: Math.min(price, to), price2: Math.max(price, to), label }
  return { coin, kind: 'level', price, label }
}

/** The list with these marks added, keeping MAX_MARKS per coin (the oldest of that coin go first). */
export function addMarks(all: readonly Mark[], add: readonly Mark[]): Mark[] {
  let list = [...all]
  for (const m of add) {
    list = list.filter(x => !(x.coin === m.coin && x.kind === m.kind && x.price === m.price && x.price2 === m.price2 && x.t === m.t && x.t2 === m.t2))
    list.push(m)
    const mine = list.filter(x => x.coin === m.coin)
    if (mine.length > MAX_MARKS) {
      const drop = mine[0]
      list = list.filter(x => x !== drop)
    }
  }
  return list
}

const when = (t: number | undefined) => new Date(t ?? 0).toISOString().slice(0, 16).replace('T', ' ')

/**
 * "level 65,000 resistance", "zone 58,000–60,000 demand", "note 2026-11-24 08:00 breakout",
 * "trend line 1,650 (2026-11-24 08:00) → 1,700 (2026-11-25 00:00) lows, now 1,712" (with `now`),
 * "fib 1,600 → 1,800: 0.382 1,723.6 · 0.5 1,700 · 0.618 1,676.4".
 */
export function markText(m: Mark, now?: number): string {
  const tail = m.label ? ` ${m.label}` : ''
  if (m.kind === 'trend') {
    const at = now === undefined ? null : trendAt(m, now)
    return `trend line ${fmtMark(m.price)} (${when(m.t)}) → ${fmtMark(m.price2 ?? m.price)} (${when(m.t2)})${tail}${at === null ? '' : `, now ${fmtPrice(at)}`}`
  }
  if (m.kind === 'fib') {
    const key = fibPrices(m).filter(x => x.r === 0.382 || x.r === 0.5 || x.r === 0.618)
    return `fib ${fmtMark(m.price)} → ${fmtMark(m.price2 ?? m.price)}: ${key.map(x => `${x.r} ${fmtMark(x.price)}`).join(' · ')}`
  }
  if (m.kind === 'zone') return `zone ${fmtMark(m.price)}–${fmtMark(m.price2 ?? m.price)}${tail}`
  if (m.kind === 'note') return `note ${when(m.t)}${tail}`
  return `level ${fmtMark(m.price)}${tail}`
}
