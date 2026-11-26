// Your trades on the chart: a public Hyperliquid wallet's fills (read straight from Hyperliquid by this PC; the
// address never goes to DaviddTech), turned into round trips, pinned, and graded: net after fees, the share that
// made money, how long they ran, and next to the TradingView alerts: which alerts were taken, how late, and what the
// skipped ones did. Under 10 cases there are no numbers. Pure: no `$`.

import type { Candle } from '../types'
import { INTERVALS } from './data'
import { day, pct, spread, wilson, MIN_CASES } from './history'
import type { TvAlert } from './live'
import { alertInterval } from './live'

/** Purple that reads on the dark and the light panel alike (about 3.5:1 or more on both). */
export const TRADE_INK = '#ab47bc'
export const TRADE_LAYER = 'trades'
/** How far back the desk reads fills. */
export const FILLS_DAYS = 90
/** An alert counts as taken when a trip opens its way within this many of its candles. */
export const TAKEN_WITHIN = 3

export type Fill = { coin: string; px: number; sz: number; side: 'B' | 'A'; time: number; start: number; dir: string; closedPnl: number; fee: number }

export type Trip = { coin: string; side: 'long' | 'short'; open: number; close: number | null; entry: number; exit: number | null; size: number; net: number; fees: number; fills: number }

/** A 0x address, 40 hex digits; null if it isn't one. */
export function walletOf(text: string): string | null {
  const m = /\b0x[0-9a-fA-F]{40}\b/.exec(text)
  return m ? m[0].toLowerCase() : null
}

/** "0x12ab…9f3c": how the desk shows an address. */
export const shortWallet = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`

/** The request body for one window of fills. */
export function fillsRequest(user: string, startTime: number, endTime: number) {
  return { type: 'userFillsByTime', user, startTime, endTime, aggregateByTime: true }
}

const num = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN)

/** Perp fills from Hyperliquid's answer (spot fills, "@107" or "PURR/USDC", are left out), oldest first. */
export function parseFills(raw: unknown): Fill[] {
  if (!Array.isArray(raw)) return []
  const out: Fill[] = []
  for (const x of raw) {
    const o = (x ?? {}) as Record<string, unknown>
    const coin = typeof o.coin === 'string' ? o.coin : ''
    if (!coin || coin.startsWith('@') || coin.includes('/')) continue
    const f: Fill = { coin, px: num(o.px), sz: num(o.sz), side: o.side === 'A' ? 'A' : 'B', time: num(o.time), start: num(o.startPosition), dir: typeof o.dir === 'string' ? o.dir : '', closedPnl: num(o.closedPnl), fee: num(o.fee) }
    if (![f.px, f.sz, f.time, f.start].every(Number.isFinite) || f.px <= 0 || f.sz <= 0) continue
    if (!Number.isFinite(f.closedPnl)) f.closedPnl = 0
    if (!Number.isFinite(f.fee)) f.fee = 0
    out.push(f)
  }
  return out.sort((a, b) => a.time - b.time)
}

/** Fills joined to the kept ones with no repeats (same coin, time, side, price and size). */
export function keepFills(kept: readonly Fill[], fresh: readonly Fill[]): Fill[] {
  const key = (f: Fill) => `${f.coin}|${f.time}|${f.side}|${f.px}|${f.sz}`
  const seen = new Set(kept.map(key))
  return [...kept, ...fresh.filter(f => !seen.has(key(f)))].sort((a, b) => a.time - b.time).slice(-10_000)
}

/**
 * Round trips per coin: a trip opens when the position leaves zero and ends when it is back at zero; a fill that
 * flips the position ends one trip and opens the next (its fee split by size). Net = closed PnL minus fees; funding is
 * not in fills and not counted. A trip still open has close null. The first fills of a coin may start mid-position
 * (startPosition not zero): that part is left out, as its opening is older than the window read.
 */
export function roundTrips(fills: readonly Fill[]): Trip[] {
  const byCoin = new Map<string, Fill[]>()
  for (const f of fills) {
    const list = byCoin.get(f.coin)
    if (list) list.push(f)
    else byCoin.set(f.coin, [f])
  }
  const trips: Trip[] = []
  const flat = (x: number) => Math.abs(x) < 1e-12
  const open = (coin: string, f: Fill, size: number, side: 'long' | 'short', feeShare: number): Trip => ({ coin, side, open: f.time, close: null, entry: f.px, exit: null, size, net: -f.fee * feeShare, fees: f.fee * feeShare, fills: 1 })
  for (const [coin, list] of byCoin) {
    let cur: Trip | null = null
    for (const f of list) {
      const start = f.start
      const signed = f.side === 'B' ? f.sz : -f.sz
      const after = start + signed
      // Hyperliquid's startPosition is the truth: a trip that doesn't match it had fills outside the window.
      if (cur && (flat(start) || Math.sign(start) !== (cur.side === 'long' ? 1 : -1))) cur = null
      if (flat(start)) {
        cur = open(coin, f, Math.abs(after), after > 0 ? 'long' : 'short', 1)
        continue
      }
      const crosses = !flat(after) && Math.sign(after) !== Math.sign(start)
      const adds = Math.sign(signed) === Math.sign(start)
      const closeShare = crosses ? Math.abs(start) / f.sz : 1
      if (cur) {
        cur.fills++
        cur.net += f.closedPnl - f.fee * closeShare
        cur.fees += f.fee * closeShare
        if (adds) {
          cur.entry = (cur.entry * cur.size + f.px * f.sz) / (cur.size + f.sz)
          cur.size += f.sz
        }
        if (flat(after) || crosses) {
          cur.close = f.time
          cur.exit = f.px
          trips.push(cur)
          cur = null
        }
      }
      if (crosses) cur = open(coin, f, Math.abs(after), after > 0 ? 'long' : 'short', 1 - closeShare)
    }
    if (cur) trips.push(cur)
  }
  return trips.sort((a, b) => a.open - b.open)
}

/** Pins for one coin: ▲ a long opening, ▼ a short opening, • a close at its price. The newest `max`. */
export function tripPins(trips: readonly Trip[], coin: string, max = 200): { t: number; dir: 'up' | 'down' | 'dot'; price?: number; label: string }[] {
  const out: { t: number; dir: 'up' | 'down' | 'dot'; price?: number; label: string }[] = []
  for (const tr of trips) {
    if (tr.coin !== coin) continue
    out.push({ t: tr.open, dir: tr.side === 'long' ? 'up' : 'down', label: `${tr.side} ${round(tr.size)}` })
    if (tr.close !== null && tr.exit !== null) out.push({ t: tr.close, dir: 'dot', price: tr.exit, label: `${tr.net >= 0 ? '+' : '-'}$${Math.abs(tr.net).toFixed(0)}` })
  }
  return out.sort((a, b) => a.t - b.t).slice(-max)
}

const round = (x: number) => (x >= 100 ? x.toFixed(0) : x >= 1 ? x.toFixed(2) : x.toPrecision(3))
const share = (x: number) => `${Math.round(x * 100)}%`
const usd = (x: number) => `${x >= 0 ? '+' : '-'}$${Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const hours = (ms: number) => (ms >= 2 * 86_400_000 ? `${(ms / 86_400_000).toFixed(1)} days` : ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(1)} hours` : `${Math.round(ms / 60_000)} minutes`)

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  if (n === 0) return NaN
  return n % 2 ? (s[(n - 1) / 2] as number) : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2
}

/** The trips in plain words: count, net, the share that made money (with its range), how long they ran, per coin. */
export function tripsText(trips: readonly Trip[], wallet: string, days: number, since?: string): string {
  const done = trips.filter(t => t.close !== null)
  const open = trips.length - done.length
  const head = `Trades of ${shortWallet(wallet)} ${since ? `since ${since}` : `over the last ${days} days`}: ${done.length} finished round trip${done.length === 1 ? '' : 's'}${open ? `, ${open} still open` : ''} (net = closed PnL after fees; funding not counted).`
  if (done.length < MIN_CASES) return `${head}\nUnder ${MIN_CASES} finished trips: no numbers yet.`
  const net = done.reduce((a, t) => a + t.net, 0)
  const fees = done.reduce((a, t) => a + t.fees, 0)
  const won = done.filter(t => t.net > 0).length
  const [lo, hi] = wilson(won, done.length)
  const lines = [head, `Net ${usd(net)} (fees ${usd(-fees)}). Made money ${share(won / done.length)} of the time [${share(lo)}–${share(hi)}]. Median time in a trade ${hours(median(done.map(t => (t.close as number) - t.open)))}.`]
  const coins = new Map<string, Trip[]>()
  for (const t of done) {
    const list = coins.get(t.coin)
    if (list) list.push(t)
    else coins.set(t.coin, [t])
  }
  const rows = [...coins.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6)
  for (const [coin, list] of rows) {
    const w = list.filter(t => t.net > 0).length
    const n = list.reduce((a, t) => a + t.net, 0)
    lines.push(`- ${coin}: ${list.length} trip${list.length === 1 ? '' : 's'}, net ${usd(n)}${list.length >= MIN_CASES ? `, made money ${share(w / list.length)}` : ''}`)
  }
  const longs = done.filter(t => t.side === 'long')
  const shorts = done.filter(t => t.side === 'short')
  if (longs.length >= MIN_CASES && shorts.length >= MIN_CASES)
    lines.push(`Longs: net ${usd(longs.reduce((a, t) => a + t.net, 0))}, made money ${share(longs.filter(t => t.net > 0).length / longs.length)}. Shorts: net ${usd(shorts.reduce((a, t) => a + t.net, 0))}, made money ${share(shorts.filter(t => t.net > 0).length / shorts.length)}.`)
  return lines.join('\n')
}

export type Habit = { alert: TvAlert; trip: Trip | null; lagMs: number | null }

/** Each long or short alert on a coin you trade: taken (a trip opened its way within TAKEN_WITHIN of its candles) or skipped. */
export function alertHabits(alerts: readonly TvAlert[], trips: readonly Trip[], coinOf: (a: TvAlert) => string | null): Habit[] {
  const traded = new Set(trips.map(t => t.coin))
  const out: Habit[] = []
  for (const a of alerts) {
    if (a.side !== 'long' && a.side !== 'short') continue
    const coin = coinOf(a)
    if (!coin || !traded.has(coin)) continue
    const within = TAKEN_WITHIN * (INTERVALS[alertInterval(a)] ?? 3_600_000)
    const trip = trips.find(t => t.coin === coin && t.side === a.side && t.open >= a.at && t.open <= a.at + within) ?? null
    out.push({ alert: a, trip, lagMs: trip ? trip.open - a.at : null })
  }
  return out
}

/**
 * The alerts you took against the ones you skipped: how many, how late, and what each kind did 20 candles on (the
 * move in the alert's direction from `moveOf`, which reads the candles).
 */
export function habitsText(h: readonly Habit[], moveOf: (a: TvAlert) => number | null): string {
  if (h.length === 0) return 'No long or short TradingView alert on a coin this wallet trades yet.'
  const taken = h.filter(x => x.trip)
  const skipped = h.filter(x => !x.trip)
  const lines = [`Of ${h.length} long or short alerts on coins you trade, you took ${taken.length} and skipped ${skipped.length} (taken = a trip opened its way within ${TAKEN_WITHIN} of its candles).`]
  if (taken.length >= MIN_CASES) lines.push(`Median time from alert to your trade: ${hours(median(taken.map(x => x.lagMs as number)))}.`)
  const mt = taken.map(x => moveOf(x.alert)).filter((x): x is number => x !== null)
  const ms = skipped.map(x => moveOf(x.alert)).filter((x): x is number => x !== null)
  if (mt.length >= MIN_CASES && ms.length >= MIN_CASES) {
    const a = spread(mt)
    const b = spread(ms)
    lines.push(`20 candles on, in the alert's direction: taken ones median ${pct(a.median, 1)} (went its way ${share(a.up)}), skipped ones median ${pct(b.median, 1)} (${share(b.up)}).`)
  } else lines.push(`Taken vs skipped moves: ${mt.length} and ${ms.length} graded so far, under ${MIN_CASES} each: no numbers yet.`)
  const tripsTaken = taken.map(x => x.trip as Trip).filter(t => t.close !== null)
  if (tripsTaken.length >= MIN_CASES) lines.push(`Trips that followed an alert: net ${usd(tripsTaken.reduce((s, t) => s + t.net, 0))}, made money ${share(tripsTaken.filter(t => t.net > 0).length / tripsTaken.length)}.`)
  return lines.join('\n')
}

/** The latest trips, newest first, one line each. */
export function tripList(trips: readonly Trip[], n = 8): string {
  return trips
    .slice(-n)
    .reverse()
    .map(t => `- ${day(t.open)} UTC · ${t.coin} ${t.side} ${round(t.size)} at ${t.entry.toPrecision(5)}${t.close !== null && t.exit !== null ? ` → ${t.exit.toPrecision(5)}, ${usd(t.net)}` : ' · open'}`)
    .join('\n')
}

/** The move 20 candles on from the first candle opening after the alert, in its direction (no funding: a quick read). */
export function moveAfter(a: TvAlert, candles: readonly Candle[], k = 20): number | null {
  let i = candles.findIndex(c => c.t >= a.at)
  if (i < 0 || i + k - 1 >= candles.length) return null
  const o = (candles[i] as Candle).o
  const c = (candles[i + k - 1] as Candle).c
  if (o <= 0) return null
  i = a.side === 'short' ? -1 : 1
  return i * (c / o - 1)
}
