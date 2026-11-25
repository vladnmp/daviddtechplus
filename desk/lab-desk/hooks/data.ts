// Hyperliquid public info API: request bodies, parsing (strings to numbers),
// funding annualisation and the number formats the desk prints. Pure: no `$`.

import type { Candle, CoinCtx, Market } from '../types'

export const INFO_URL = 'https://api.hyperliquid.xyz/info'
export const DATA_LINE = 'Market data: Hyperliquid public API'
export const DEFAULT_WATCH = ['BTC', 'ETH', 'SOL', 'HYPE']
export const MAX_WATCH = 6
/** How many candles one chart read asks for: enough for a wide pane. */
export const CANDLES_WANTED = 300

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Hyperliquid's candle intervals and their length in ms. */
export const INTERVALS: Readonly<Record<string, number>> = {
  '1m': MINUTE,
  '3m': 3 * MINUTE,
  '5m': 5 * MINUTE,
  '15m': 15 * MINUTE,
  '30m': 30 * MINUTE,
  '1h': HOUR,
  '2h': 2 * HOUR,
  '4h': 4 * HOUR,
  '8h': 8 * HOUR,
  '12h': 12 * HOUR,
  '1d': DAY,
  '3d': 3 * DAY,
  '1w': 7 * DAY,
  '1M': 30 * DAY,
}

/** The interval as Hyperliquid spells it, or null. `1M` (month) keeps its capital. */
export function intervalOf(raw: string): string | null {
  const s = raw.trim()
  if (s === '1M') return s
  const lower = s.toLowerCase()
  return lower in INTERVALS ? lower : null
}

/** How often the chart refreshes for an interval: 15 s for short candles, 60 s for long ones. */
export function refreshMs(interval: string): number {
  const len = INTERVALS[interval] ?? HOUR
  if (len <= 5 * MINUTE) return 15_000
  if (len <= HOUR) return 30_000
  return 60_000
}

export function candleBody(coin: string, interval: string, now: number, count = CANDLES_WANTED): string {
  const len = INTERVALS[interval] ?? HOUR
  return JSON.stringify({ type: 'candleSnapshot', req: { coin, interval, startTime: now - count * len, endTime: now } })
}

export const CTX_BODY = JSON.stringify({ type: 'metaAndAssetCtxs' })

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** candleSnapshot's answer as candles, oldest first; rows that do not parse are dropped. */
export function parseCandles(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) return []
  const out: Candle[] = []
  for (const row of raw as Record<string, unknown>[]) {
    const t = num(row?.t)
    const o = num(row?.o)
    const h = num(row?.h)
    const l = num(row?.l)
    const c = num(row?.c)
    const v = num(row?.v) ?? 0
    if (t === null || o === null || h === null || l === null || c === null) continue
    out.push({ t, o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v })
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

/** metaAndAssetCtxs' answer: each perp by name, its contexts in the universe's order. */
export function parseMarket(raw: unknown, at: number): Market | null {
  if (!Array.isArray(raw) || raw.length < 2) return null
  const universe = (raw[0] as { universe?: unknown } | null)?.universe
  const ctxs = raw[1]
  if (!Array.isArray(universe) || !Array.isArray(ctxs)) return null
  const coins: Record<string, CoinCtx> = {}
  universe.forEach((u: { name?: unknown }, i: number) => {
    const ctx = ctxs[i] as Record<string, unknown> | undefined
    if (typeof u?.name !== 'string' || !ctx) return
    const price = num(ctx.markPx) ?? num(ctx.midPx) ?? num(ctx.oraclePx)
    if (price === null) return
    coins[u.name] = {
      coin: u.name,
      price,
      prevDay: num(ctx.prevDayPx),
      funding: num(ctx.funding),
      openInterest: num(ctx.openInterest),
      dayVolume: num(ctx.dayNtlVlm),
    }
  })
  return Object.keys(coins).length > 0 ? { at, coins } : null
}

/** The perp's exact name on Hyperliquid for what a person typed (any case), or null. */
export function resolveCoin(market: Market | null, typed: string): string | null {
  const want = typed.trim()
  if (!market || want === '') return null
  if (market.coins[want]) return want
  const lower = want.toLowerCase()
  return Object.keys(market.coins).find(name => name.toLowerCase() === lower) ?? null
}

/** Hourly funding rate to an annual percentage: rate x 24 x 365 x 100. */
export function annualFundingPct(hourly: number): number {
  return hourly * 24 * 365 * 100
}

/** 24h change in %, from the previous day's price; null when unknown. */
export function changePct(ctx: CoinCtx | undefined): number | null {
  if (!ctx || ctx.prevDay === null || ctx.prevDay === 0) return null
  return ((ctx.price - ctx.prevDay) / ctx.prevDay) * 100
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** A price as traders read it: 97,123 · 3,456.7 · 182.35 · 24.510 · 0.012345. */
export function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return '-'
  const a = Math.abs(p)
  // Five significant figures, as Hyperliquid quotes: 97,123 · 3,456.7 · 24.510 · 0.012345.
  const decimals = a === 0 ? 2 : a >= 1 ? Math.max(0, 5 - (Math.floor(Math.log10(a)) + 1)) : Math.min(10, 4 - Math.floor(Math.log10(a)))
  const [i, f] = Math.abs(p).toFixed(decimals).split('.')
  return (p < 0 ? '-' : '') + group(i ?? '0') + (f ? '.' + f : '')
}

/** A signed percentage: +1.24% · -0.40%. */
export function fmtPct(p: number | null, decimals = 2): string {
  if (p === null || !Number.isFinite(p)) return '-'
  return (p > 0 ? '+' : p < 0 ? '-' : '') + Math.abs(p).toFixed(decimals) + '%'
}

/** A dollar size: $1.23B · $456.7M · $12.3K. */
export function fmtUsd(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '-'
  const a = Math.abs(v)
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

/** "+10.95%/yr funding" from an hourly rate. */
export function fundingText(hourly: number | null): string {
  return hourly === null ? 'funding -' : `funding ${fmtPct(annualFundingPct(hourly))}/yr`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A candle time in UTC: "Tue 16 Nov 14:00", or "16 Nov 2026" for daily and longer candles. */
export function fmtTime(ms: number, interval: string): string {
  const d = new Date(ms)
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
  if ((INTERVALS[interval] ?? HOUR) >= DAY) return `${date} ${d.getUTCFullYear()}`
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${DAYS[d.getUTCDay()]} ${date} ${hh}:${mm}`
}

/** "BTC 97,123 +1.24%": a coin's price and 24h change, for the band and the widget. */
export function coinLine(coin: string, ctx: CoinCtx | undefined): string {
  if (!ctx) return `${coin} -`
  return `${coin} ${fmtPrice(ctx.price)} ${fmtPct(changePct(ctx), 1)}`
}

/** The watchlist line above the prompt, cut to `columns` with an ellipsis. */
export function bandText(coins: readonly string[], market: Market | null, columns: number): string {
  const parts = coins.map(c => coinLine(c, market?.coins[c]))
  const text = parts.join(' · ')
  if (columns <= 0) return ''
  return text.length <= columns ? text : text.slice(0, Math.max(0, columns - 1)) + '…'
}

/** "14:32:05": a time of day in UTC. */
export function fmtClock(ms: number): string {
  const d = new Date(ms)
  return [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}

/** How old data is: "45s" under a minute, "2m" under an hour, else "3h". */
export function ageText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

/** Stale once data is two refresh periods old; one failed refresh is not enough. */
export function isStale(ageMs: number | null, periodMs: number): boolean {
  return ageMs !== null && ageMs >= 2 * periodMs
}

/** The age of data at `dataAt` as of the last refresh attempt, or null before any data. */
export function ageOf(dataAt: number | null, checked: number): number | null {
  return dataAt === null ? null : Math.max(0, checked - dataAt)
}

/** When the chart's data is from: the older of its candles and the market read; null before both. */
export function chartDataAt(chartAt: number, market: Market | null): number | null {
  if (!(chartAt > 0) || !market) return null
  return Math.min(chartAt, market.at)
}

/** "as of 14:32:05 UTC", or "stale 2m" once two refresh periods passed with no new data, or "loading". */
export function freshText(dataAt: number | null, checked: number, periodMs: number): string {
  if (dataAt === null) return 'loading'
  const age = ageOf(dataAt, checked)
  return isStale(age, periodMs) ? `stale ${ageText(age ?? 0)}` : `as of ${fmtClock(dataAt)} UTC`
}

/** The status line (plain text): "Lab desk READ-ONLY · as of 14:32:05 UTC · BTC 65,137 -1.2% · funding +10.95%/yr". */
export function statusText(coin: string, ctx: CoinCtx | undefined, dataAt: number | null, checked: number, periodMs: number): string {
  const head = 'Lab desk READ-ONLY'
  if (!ctx || dataAt === null) return `${head} · loading · ${coin} -`
  return `${head} · ${freshText(dataAt, checked, periodMs)} · ${coin} ${fmtPrice(ctx.price)} ${fmtPct(changePct(ctx), 1)} · ${fundingText(ctx.funding)}`
}

/** The words of /lab-watch: coins, upper-cased, de-duplicated, at most six. */
export function watchArgs(args: string): string[] {
  const seen = new Set<string>()
  for (const w of args.split(/[\s,]+/)) {
    const c = w.trim().toUpperCase()
    if (c !== '' && /^[A-Z0-9]{1,12}$/.test(c)) seen.add(c)
  }
  return [...seen].slice(0, MAX_WATCH)
}

/** The watchlist's coins as Hyperliquid spells them (kPEPE stays kPEPE). */
export function watchNames(coins: readonly string[], market: Market | null): string[] {
  return coins.map(c => resolveCoin(market, c) ?? c)
}
