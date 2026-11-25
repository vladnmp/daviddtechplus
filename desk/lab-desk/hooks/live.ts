// TradingView alerts on the desk: the feed from DaviddTech+ (each alert the member's TradingView sent to their
// private link), the alerts kept on this PC, their pins, and the alert scorecard: what came after each alert, 5, 20
// and 50 candles on, with the real funding, next to any candle. Under 10 cases there are no numbers.
// Pure: no `$`.

import type { Candle, Market } from '../types'
import { INTERVALS, resolveCoin } from './data'
import type { Funding } from './honest'
import { fundingBetween } from './honest'
import { afterStudy, day, parseCondition, pct, spread, MIN_CASES } from './history'
import type { Spread } from './history'

/** Alerts kept on this PC (the server keeps 30 days; the scorecard needs longer). */
export const MAX_KEPT = 2000
/** How often the desk asks for new alerts. */
export const FEED_MS = 60_000
/** Candles after an alert the scorecard looks at. */
export const STEPS = [5, 20, 50] as const
export const MAX_PINS_SHOWN = 200
/** Orange that reads on the dark and the light panel alike (about 3:1 or more on both). */
export const ALERT_INK = '#ef6c00'
export const ALERT_LAYER = 'tv alerts'

export type DplusAt = { symbol: string; days: number; as_of: string; lean: string; chance_up: number; range80: [number, number] }

/** One alert as the feed gives it (``tvalerts.parse_alert`` on the server), `at` = when it arrived (ms). */
export type TvAlert = {
  id: string
  at: number
  name?: string
  ticker?: string
  exchange?: string
  interval?: string
  side?: 'long' | 'short' | 'close'
  price?: number
  rule?: string
  note?: string
  coin?: string
  symbol?: string
  dplus?: DplusAt
}

const str = (v: unknown, n = 200): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, n) : undefined)

/** The alerts in a feed answer (`{ ok, alerts: [...] }`), each checked field by field; junk is dropped. */
export function parseFeed(raw: unknown): TvAlert[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { alerts?: unknown }).alerts) ? ((raw as { alerts: unknown[] }).alerts) : []
  const out: TvAlert[] = []
  for (const x of list) {
    const o = (x ?? {}) as Record<string, unknown>
    const id = str(o.id, 16)
    const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : null
    if (!id || at === null || !/^[0-9a-f]+$/.test(id)) continue
    const a: TvAlert = { id, at }
    for (const k of ['name', 'ticker', 'exchange', 'interval', 'rule', 'note', 'coin', 'symbol'] as const) {
      const v = str(o[k])
      if (v) a[k] = v
    }
    if (o.side === 'long' || o.side === 'short' || o.side === 'close') a.side = o.side
    if (typeof o.price === 'number' && o.price > 0) a.price = o.price
    const d = o.dplus as Record<string, unknown> | undefined
    if (d && typeof d.lean === 'string' && Array.isArray(d.range80) && d.range80.length === 2 && typeof d.chance_up === 'number')
      a.dplus = { symbol: String(d.symbol ?? ''), days: Number(d.days ?? 5), as_of: String(d.as_of ?? ''), lean: d.lean, chance_up: d.chance_up, range80: [Number(d.range80[0]), Number(d.range80[1])] }
    out.push(a)
  }
  return out
}

/** The feed address from what the person pasted: the webhook link or the feed link itself. Null if it isn't one. */
export function feedUrlOf(text: string): string | null {
  const m = /https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/tv\/[0-9a-f]{20}[A-Za-z0-9_-]{24}/.exec(text) ?? /http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/tv\/[0-9a-f]{20}[A-Za-z0-9_-]{24}/.exec(text)
  return m ? `${m[0]}/recent` : null
}

/** The feed address with the cursor: only alerts after the last one kept. */
export function feedQuery(url: string, lastId: string | null): string {
  return lastId ? `${url}?after=${lastId}` : url
}

/** The kept list with new alerts added (no repeats by id), newest last, at most MAX_KEPT. */
export function keepAlerts(kept: readonly TvAlert[], fresh: readonly TvAlert[]): TvAlert[] {
  const seen = new Set(kept.map(a => a.id))
  return [...kept, ...fresh.filter(a => !seen.has(a.id))].sort((a, b) => a.at - b.at).slice(-MAX_KEPT)
}

export function lastId(kept: readonly TvAlert[]): string | null {
  let best: string | null = null
  for (const a of kept) if (best === null || parseInt(a.id, 16) > parseInt(best, 16)) best = a.id
  return best
}

/** The Hyperliquid perp an alert is about, checked against the live list; null when it isn't one. */
export function alertCoin(a: TvAlert, market: Market | null): string | null {
  if (!a.coin) return null
  return market ? resolveCoin(market, a.coin) : a.coin
}

/** An alert's interval as the desk spells it, defaulting to 1h. */
export function alertInterval(a: TvAlert): string {
  return a.interval && INTERVALS[a.interval] ? a.interval : '1h'
}

const SIDE_WORD = { long: 'long', short: 'short', close: 'close' } as const

/** "RSI dip · SOL 4h · long at 151.2" */
export function alertLine(a: TvAlert): string {
  const what = [a.name ?? a.rule ?? 'alert', `${a.coin ?? a.ticker ?? '?'}${a.interval ? ` ${a.interval}` : ''}`, a.side ? `${SIDE_WORD[a.side]}${a.price ? ` at ${a.price}` : ''}` : a.price ? `at ${a.price}` : null]
  return what.filter(Boolean).join(' · ')
}

/** "DaviddTech+ 5 days: slightly upward, 56% up, 80% range -6.0% to +7.5%" */
export function dplusLine(d: DplusAt): string {
  return `DaviddTech+ ${d.days} days: ${d.lean}, ${Math.round(d.chance_up * 100)}% up, 80% range ${d.range80[0] >= 0 ? '+' : ''}${d.range80[0].toFixed(1)}% to ${d.range80[1] >= 0 ? '+' : ''}${d.range80[1].toFixed(1)}%`
}

/** What the toast says for a new alert. */
export function toastText(a: TvAlert): string {
  return `TradingView: ${alertLine(a)}${a.dplus ? ` · ${dplusLine(a.dplus)}` : ''}`
}

/** Pins for the chart's coin and interval: ▲ long, ▼ short, • close or no side, the newest MAX_PINS_SHOWN. */
export function alertPins(kept: readonly TvAlert[], coin: string, interval: string, market: Market | null): { t: number; dir: 'up' | 'down' | 'dot'; price?: number; label: string }[] {
  return kept
    .filter(a => alertCoin(a, market) === coin && alertInterval(a) === interval)
    .slice(-MAX_PINS_SHOWN)
    .map(a => ({ t: a.at, dir: a.side === 'long' ? 'up' : a.side === 'short' ? 'down' : 'dot', ...(a.side !== 'long' && a.side !== 'short' && a.price ? { price: a.price } : {}), label: (a.name ?? a.rule ?? 'alert').slice(0, 24) }) as const)
}

// ---------------------------------------------------------------------------
// The scorecard
// ---------------------------------------------------------------------------

/** One group: the same alert name on the same coin and interval. */
export type Group = { key: string; name: string; coin: string | null; interval: string; side: 'long' | 'short' | 'close' | null; rule: string | null; alerts: TvAlert[] }

export function groupAlerts(kept: readonly TvAlert[], market: Market | null): Group[] {
  const by = new Map<string, Group>()
  for (const a of kept) {
    const coin = alertCoin(a, market)
    const interval = alertInterval(a)
    const name = a.name ?? a.rule ?? 'alert'
    const key = `${name.toLowerCase()}|${coin ?? a.ticker ?? '?'}|${interval}`
    const g = by.get(key) ?? { key, name, coin, interval, side: null, rule: null, alerts: [] }
    g.alerts.push(a)
    if (a.side && a.side !== 'close') g.side = g.side && g.side !== a.side ? null : a.side
    if (a.rule && !g.rule) g.rule = a.rule
    by.set(key, g)
  }
  return [...by.values()].sort((x, y) => y.alerts.length - x.alerts.length)
}

/** The sign an alert is graded in: +1 long or no side (the move up), -1 short. */
const signOf = (a: TvAlert) => (a.side === 'short' ? -1 : 1)

/** Index of the first candle that opens at or after `t` (the alert is graded from there), or -1. */
export function firstOpenAfter(candles: readonly Candle[], t: number): number {
  let lo = 0
  let hi = candles.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((candles[mid] as Candle).t < t) lo = mid + 1
    else hi = mid
  }
  return lo < candles.length ? lo : -1
}

/** The move from the open of candle i to the close of candle i+k-1, in the alert's direction, with funding. */
function moveAt(candles: readonly Candle[], funding: readonly Funding[], i: number, k: number, sign: number, step: number): number | null {
  const a = candles[i]
  const b = candles[i + k - 1]
  if (!a || !b || a.o <= 0) return null
  return sign * (b.c / a.o - 1) - sign * fundingBetween(funding, a.t, b.t + step)
}

export type Step = { k: number; cases: number[]; open: number; stats: Spread | null; base: Spread }

export type Score = { group: Group; graded: number; steps: Step[]; dplus: { agree: number[]; against: number[]; k: number } | null; backtest: { k: number; n: number; median: number; up: number } | null; from: number; to: number }

/**
 * The scorecard of one group on its coin's closed candles: for each of STEPS, every alert graded from the first
 * candle that opens after it arrived, alerts at least k candles apart (five alerts in a row count as one), the move
 * in the alert's direction with funding; and the same for any candle in the same stretch.
 */
export function scoreGroup(g: Group, candles: readonly Candle[], funding: readonly Funding[]): Score {
  const step = INTERVALS[g.interval] ?? 3_600_000
  const sorted = [...g.alerts].sort((a, b) => a.at - b.at)
  const sign = g.side === 'short' ? -1 : 1
  const steps: Step[] = []
  let graded = 0
  for (const k of STEPS) {
    const cases: number[] = []
    let open = 0
    let next = 0
    for (const a of sorted) {
      const i = firstOpenAfter(candles, a.at)
      if (i < 0 || i + k - 1 >= candles.length) {
        open++
        continue
      }
      if (i < next) continue
      const m = moveAt(candles, funding, i, k, signOf(a), step)
      if (m === null) continue
      cases.push(m)
      next = i + k
    }
    graded = Math.max(graded, cases.length)
    // Any candle over the stretch the alerts cover (from a week before the first): the yardstick.
    const i0 = Math.max(0, firstOpenAfter(candles, (sorted[0]?.at ?? 0) - 7 * 86_400_000))
    const base: number[] = []
    for (let i = i0; i + k - 1 < candles.length; i++) {
      const m = moveAt(candles, funding, i, k, sign, step)
      if (m !== null) base.push(m)
    }
    steps.push({ k, cases, open, stats: cases.length >= MIN_CASES ? spread(cases) : null, base: spread(base) })
  }
  return { group: g, graded, steps, dplus: dplusSplit(sorted, candles, funding, step), backtest: null, from: sorted[0]?.at ?? 0, to: sorted.at(-1)?.at ?? 0 }
}

/** DaviddTech+ leaned the alert's way (upward for long, downward for short), or against it; null when neutral or none. */
export function dplusAgrees(a: TvAlert): boolean | null {
  if (!a.dplus || !a.side || a.side === 'close') return null
  const up = /upward/.test(a.dplus.lean) && !/downward/.test(a.dplus.lean)
  const down = /downward/.test(a.dplus.lean)
  if (!up && !down) return null
  return a.side === 'long' ? up : down
}

/** The moves after alerts where DaviddTech+ leaned the same way vs against, over the step closest to its 5 days. */
function dplusSplit(sorted: readonly TvAlert[], candles: readonly Candle[], funding: readonly Funding[], step: number): Score['dplus'] {
  if (!sorted.some(a => a.dplus)) return null
  const days = sorted.find(a => a.dplus)?.dplus?.days ?? 5
  const want = (days * 86_400_000) / step
  const k = [...STEPS].sort((x, y) => Math.abs(x - want) - Math.abs(y - want))[0] as number
  const agree: number[] = []
  const against: number[] = []
  for (const a of sorted) {
    const v = dplusAgrees(a)
    if (v === null) continue
    const i = firstOpenAfter(candles, a.at)
    if (i < 0 || i + k - 1 >= candles.length) continue
    const m = moveAt(candles, funding, i, k, signOf(a), step)
    if (m !== null) (v ? agree : against).push(m)
  }
  return { agree, against, k }
}

/** The backtest of the group's rule on the same candles, k candles on: the history lab's "what happened after". */
export function backtestOf(rule: string, candles: readonly Candle[], k: number, side: 'long' | 'short' | 'close' | null): Score['backtest'] {
  const c = parseCondition(rule)
  if ('error' in c) return null
  const a = afterStudy(c, candles, k)
  if (!a.stats) return { k, n: a.cases.length, median: NaN, up: NaN }
  const sign = side === 'short' ? -1 : 1
  const s = spread(a.cases.map(x => sign * x.ret))
  return { k, n: s.n, median: s.median, up: s.up }
}

const share = (x: number) => `${Math.round(x * 100)}%`
const range = (s: Spread) => `${share(s.upLo)}–${share(s.upHi)}`

/** The plain words for one step: the median, middle half, share in the alert's direction, and any candle's. */
function stepRow(s: Step, dirWord: string): string {
  if (!s.stats) return `  ${String(s.k).padStart(2)} on: ${s.cases.length} case${s.cases.length === 1 ? '' : 's'}${s.open ? `, ${s.open} still open` : ''}: no numbers under ${MIN_CASES}`
  const st = s.stats
  return `  ${String(s.k).padStart(2)} on: median ${pct(st.median, 1)} (middle half ${pct(st.p25, 1)} to ${pct(st.p75, 1)}), ${dirWord} ${share(st.up)} [${range(st)}] · any candle ${pct(s.base.median, 1)}, ${dirWord} ${share(s.base.up)}`
}

/** Whether the alert's share range sits above any candle's share at the 20-candle step. */
export function scoreVerdict(sc: Score): string | null {
  const s = sc.steps.find(x => x.k === 20) ?? sc.steps[0]
  if (!s?.stats) return null
  if (s.stats.upLo > s.base.up) return `Clearly better than any candle at ${s.k} on, live.`
  if (s.stats.upHi < s.base.up) return `Clearly worse than any candle at ${s.k} on, live.`
  return `At ${s.k} on it is not yet apart from any candle: could be chance so far.`
}

/** The scorecard of one group, in full. */
export function scoreText(sc: Score): string {
  const g = sc.group
  const dirWord = g.side === 'short' ? 'down' : 'up'
  const lines = [`${g.name} · ${g.coin} ${g.interval}${g.side ? ` · ${g.side}` : ''}: ${g.alerts.length} alert${g.alerts.length === 1 ? '' : 's'} from ${day(sc.from)} to ${day(sc.to)} UTC, ${sc.graded} graded (at each step, alerts closer together than that count once; funding counted, no fees).`]
  for (const s of sc.steps) lines.push(stepRow(s, dirWord))
  const v = scoreVerdict(sc)
  if (v) lines.push(`  ${v}`)
  if (sc.dplus) {
    const { agree, against, k } = sc.dplus
    if (agree.length >= MIN_CASES && against.length >= MIN_CASES) {
      const a = spread(agree)
      const b = spread(against)
      lines.push(`  With DaviddTech+ leaning the same way (${agree.length}): median ${pct(a.median, 1)}, ${dirWord} ${share(a.up)}; leaning against (${against.length}): median ${pct(b.median, 1)}, ${dirWord} ${share(b.up)} (${k} on).`)
    } else lines.push(`  DaviddTech+ leaned the same way ${agree.length} times and against ${against.length}: under ${MIN_CASES} each, too few to compare yet.`)
  }
  if (sc.backtest) {
    const b = sc.backtest
    const live = sc.steps.find(x => x.k === b.k)?.stats
    if (b.n < MIN_CASES || !Number.isFinite(b.median)) lines.push(`  Backtest of the rule "${g.rule}": ${b.n} cases in this history, under ${MIN_CASES}: no numbers.`)
    else lines.push(`  Backtest of the rule "${g.rule}" on the same history, ${b.k} on: median ${pct(b.median, 1)}, ${dirWord} ${share(b.up)} over ${b.n} cases · live: ${live ? `median ${pct(live.median, 1)}, ${dirWord} ${share(live.up)}` : `under ${MIN_CASES} cases yet`}.`)
  }
  return lines.join('\n')
}

/** One short line per group for the summary. */
export function scoreRow(sc: Score): string {
  const g = sc.group
  const s = sc.steps.find(x => x.k === 20)
  const head = `${g.name} · ${g.coin} ${g.interval}: ${g.alerts.length} fired`
  if (!s?.stats) return `${head}, ${sc.graded} graded: no numbers under ${MIN_CASES}`
  return `${head}, 20 on: median ${pct(s.stats.median, 1)}, ${g.side === 'short' ? 'down' : 'up'} ${share(s.stats.up)} vs any candle ${share(s.base.up)}`
}

/** Alerts the desk can't grade: not a Hyperliquid perp (stocks, currency pairs, or a ticker it can't read). */
export function ungradedLine(groups: readonly Group[]): string | null {
  const off = groups.filter(g => g.coin === null)
  if (off.length === 0) return null
  const n = off.reduce((a, g) => a + g.alerts.length, 0)
  const names = off.slice(0, 4).map(g => `${g.name} (${g.alerts[0]?.ticker ?? '?'})`).join(', ')
  return `${n} alert${n === 1 ? '' : 's'} not graded here, not a Hyperliquid perp: ${names}${off.length > 4 ? ', …' : ''}. Each keeps the DaviddTech+ range it came with.`
}

/** The latest alerts, newest first, one line each. */
export function listText(kept: readonly TvAlert[], n = 10): string {
  if (kept.length === 0) return 'No TradingView alerts yet.'
  return kept
    .slice(-n)
    .reverse()
    .map(a => `- ${day(a.at)} UTC · ${alertLine(a)}${a.dplus ? ` · ${dplusLine(a.dplus)}` : ''}`)
    .join('\n')
}
