// Deep history: years of free public data, read once and kept on the person's PC, for the history lab and the honest
// test. Candles and funding from Binance's USDT perps, open interest from Bybit, the crypto fear gauge (DVOL) from
// Deribit and the stock fear gauge (VIX) from FRED. No keys, no account; the PC reads them for its own research and
// nothing is sent anywhere else. Pure parsing and merging here; the reads go through the `get` handed in.
import type { Candle } from '../types'
import type { Funding } from './honest'

/** Most candles kept per coin and interval: 1h reaches about 5.7 years, 4h and 1d all of it. One file stays under 4 MiB. */
export const DEEP_MAX = 50_000
export const BINANCE_FEE = 0.0005
export const DEEP_DATA_LINE = 'Market data: Binance public API (candles, funding)'

const HOUR = 3_600_000
const DAY = 86_400_000
export const DEEP_STEP: Record<string, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': HOUR, '4h': 4 * HOUR, '1d': DAY, '1w': 7 * DAY }

/** Hyperliquid coins whose Binance perp is not 1000<NAME>USDT, and how many of its units make one Hyperliquid unit. */
const BINANCE_ODD: Record<string, { symbol: string; per: number }> = { kNEIRO: { symbol: 'NEIROUSDT', per: 1000 } }
/** Hyperliquid coins whose Bybit perp is not named like Binance's. */
const BYBIT_ODD: Record<string, string> = { kSHIB: 'SHIB1000USDT', kNEIRO: '1000NEIROCTOUSDT' }

/** Hyperliquid's name as Binance's USDT perp: BTC → BTCUSDT, kPEPE → 1000PEPEUSDT, kNEIRO → NEIROUSDT. */
export function binanceSymbol(coin: string): string {
  const odd = BINANCE_ODD[coin]
  if (odd) return odd.symbol
  const k = /^k([A-Z0-9]+)$/.exec(coin)
  return k ? `1000${k[1]}USDT` : `${coin.toUpperCase()}USDT`
}

/** Binance's candles in Hyperliquid's units (kNEIRO is 1000 NEIRO): prices times the factor, volume divided by it. */
export function toCoinUnits(coin: string, rows: Candle[]): Candle[] {
  const per = BINANCE_ODD[coin]?.per ?? 1
  return per === 1 ? rows : rows.map(c => ({ ...c, o: c.o * per, h: c.h * per, l: c.l * per, c: c.c * per, v: c.v / per }))
}

/** Hyperliquid's name as Bybit's USDT perp (open interest). */
export function bybitSymbol(coin: string): string {
  const k = /^k([A-Z0-9]+)$/.exec(coin)
  return BYBIT_ODD[coin] ?? (k ? `1000${k[1]}USDT` : `${coin.toUpperCase()}USDT`)
}

export function klinesUrl(symbol: string, interval: string, from: number): string {
  return `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${from}&limit=1500`
}

export function fundingUrl(symbol: string, from: number): string {
  return `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&startTime=${from}&limit=1000`
}

const OI_INTERVAL: Record<string, string> = { '1m': '5min', '5m': '5min', '15m': '15min', '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1d' }

export function oiUrl(symbol: string, interval: string, from: number, to: number, cursor = ''): string {
  return `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=${OI_INTERVAL[interval] ?? '1h'}&limit=200&startTime=${from}&endTime=${to}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
}

export function dvolUrl(currency: string, from: number, to: number): string {
  return `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${currency}&start_timestamp=${from}&end_timestamp=${to}&resolution=1D`
}

export const VIX_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS'

/** Binance's klines answer as candles; an error answer (unknown symbol) as its message. */
export function parseKlines(text: string): Candle[] | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { error: 'Binance sent something that is not JSON' }
  }
  if (!Array.isArray(raw)) return { error: String((raw as { msg?: unknown })?.msg ?? 'Binance answered with an error') }
  const out: Candle[] = []
  for (const k of raw) {
    if (!Array.isArray(k)) continue
    const c = { t: Number(k[0]), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) }
    if ([c.t, c.o, c.h, c.l, c.c, c.v].every(Number.isFinite)) out.push(c)
  }
  return out
}

/** Binance funding rows as { t, rate } (the rate paid at that settlement). */
export function parseFundingRows(text: string): Funding[] | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { error: 'Binance sent something that is not JSON' }
  }
  if (!Array.isArray(raw)) return { error: String((raw as { msg?: unknown })?.msg ?? 'Binance answered with an error') }
  return raw
    .map(x => ({ t: Number((x as { fundingTime?: unknown }).fundingTime), rate: Number((x as { fundingRate?: unknown }).fundingRate) }))
    .filter(x => Number.isFinite(x.t) && Number.isFinite(x.rate))
}

/**
 * Settlement rates (every 8 hours on most Binance perps, 4 or 1 on some) as hourly rows, so the rest of the desk reads
 * them like Hyperliquid's: each settlement spread evenly over the hours since the one before. Funding paid over a
 * trade is then counted hour by hour rather than all at the settlement minute.
 */
export function hourlyFunding(rows: readonly Funding[]): Funding[] {
  const out: Funding[] = []
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k] as Funding
    const t = Math.round(r.t / HOUR) * HOUR
    const prev = k > 0 ? Math.round((rows[k - 1] as Funding).t / HOUR) * HOUR : t - 8 * HOUR
    const hours = Math.max(1, Math.min(8, Math.round((t - prev) / HOUR)))
    for (let h = hours - 1; h >= 0; h--) out.push({ t: t - h * HOUR, rate: r.rate / hours })
  }
  return out
}

export type Point = { t: number; v: number }

/** Each settlement as a point at its own time, %/yr by its own interval: what conditions may read (nothing before it settles). */
export function settledFunding(rows: readonly Funding[]): Point[] {
  return rows.map((r, k) => {
    const t = Math.round(r.t / HOUR) * HOUR
    const prev = k > 0 ? Math.round((rows[k - 1] as Funding).t / HOUR) * HOUR : t - 8 * HOUR
    const hours = Math.max(1, Math.min(8, Math.round((t - prev) / HOUR)))
    return { t, v: r.rate * (24 / hours) * 365 * 100 }
  })
}

/**
 * The candles with the latest settled funding (%/yr) known at each close; null before the first settlement and where
 * the latest one is over 9 hours old at the close (a gap, or the read stopped early), so those candles don't count.
 */
export function withSettledFunding(candles: readonly Candle[], settled: readonly Point[], step: number): Candle[] {
  let k = 0
  let last: Point | null = null
  return candles.map(c => {
    const close = c.t + step
    while (k < settled.length && (settled[k] as Point).t <= close) last = settled[k++] as Point
    return { ...c, f: last && close - last.t <= 9 * HOUR ? last.v : null }
  })
}

/** Bybit's open interest answer, oldest first, and the cursor for the next page. Counts one side of each contract. */
export function parseOi(text: string): { rows: Point[]; cursor: string } | { error: string } {
  let raw: { retCode?: unknown; retMsg?: unknown; result?: { list?: unknown; nextPageCursor?: unknown } }
  try {
    raw = JSON.parse(text) as typeof raw
  } catch {
    return { error: 'Bybit sent something that is not JSON' }
  }
  if (raw.retCode !== 0 || !Array.isArray(raw.result?.list)) return { error: String(raw.retMsg ?? 'Bybit answered with an error') }
  const rows = (raw.result.list as { timestamp?: unknown; openInterest?: unknown; singleOpenInterest?: unknown }[])
    .map(x => ({ t: Number(x.timestamp), v: x.singleOpenInterest !== undefined && x.singleOpenInterest !== '' ? Number(x.singleOpenInterest) : Number(x.openInterest) / 2 }))
    .filter(x => Number.isFinite(x.t) && Number.isFinite(x.v))
    .sort((a, b) => a.t - b.t)
  return { rows, cursor: typeof raw.result.nextPageCursor === 'string' ? raw.result.nextPageCursor : '' }
}

/** Deribit DVOL daily bars as points at each day's close (the bar's start plus a day), oldest first. */
export function parseDvol(text: string): { rows: Point[]; more: number | null } | { error: string } {
  let raw: { result?: { data?: unknown; continuation?: unknown }; error?: { message?: unknown } }
  try {
    raw = JSON.parse(text) as typeof raw
  } catch {
    return { error: 'Deribit sent something that is not JSON' }
  }
  if (!Array.isArray(raw.result?.data)) return { error: String(raw.error?.message ?? 'Deribit answered with an error') }
  const rows = (raw.result.data as unknown[][])
    .map(b => ({ t: Number(b[0]) + DAY, v: Number(b[4]) }))
    .filter(x => Number.isFinite(x.t) && Number.isFinite(x.v))
    .sort((a, b) => a.t - b.t)
  const more = typeof raw.result.continuation === 'number' ? raw.result.continuation : null
  return { rows, more }
}

/** FRED's VIX close per US trading day, as points the next midnight UTC (when the close is surely known). */
export function parseVix(text: string): Point[] {
  const out: Point[] = []
  for (const line of text.split(/\r?\n/).slice(1)) {
    const [d, v] = line.split(',')
    const t = Date.parse(`${d}T00:00:00Z`)
    const n = Number(v)
    if (Number.isFinite(t) && v !== '.' && Number.isFinite(n)) out.push({ t: t + DAY, v: n })
  }
  return out
}

/** Old rows and new ones by time, a newer row replacing one at the same time; the last `max` kept. */
export function mergeByTime<T extends { t: number }>(old: readonly T[], add: readonly T[], max = Infinity): T[] {
  const m = new Map<number, T>()
  for (const x of old) m.set(x.t, x)
  for (const x of add) m.set(x.t, x)
  const out = [...m.values()].sort((a, b) => a.t - b.t)
  return out.length > max ? out.slice(out.length - max) : out
}

/** The value known at the close of each candle: the latest point at or before it; null before the first. */
export function valuesAtClose(candles: readonly Candle[], points: readonly Point[], step: number): (number | null)[] {
  let k = 0
  let last: number | null = null
  return candles.map(c => {
    const close = c.t + step
    while (k < points.length && (points[k] as Point).t <= close) last = (points[k++] as Point).v
    return last
  })
}

/** The candles with open interest, the fear gauges and funding attached where read (each only what was known then). */
export function withExtras(candles: readonly Candle[], step: number, x: { oi?: readonly Point[]; dvol?: readonly Point[]; vix?: readonly Point[] }): Candle[] {
  const oi = x.oi ? valuesAtClose(candles, x.oi, step) : null
  const dv = x.dvol ? valuesAtClose(candles, x.dvol, step) : null
  const vx = x.vix ? valuesAtClose(candles, x.vix, step) : null
  return candles.map((c, i) => ({ ...c, ...(oi ? { oi: oi[i] ?? null } : {}), ...(dv ? { dv: dv[i] ?? null } : {}), ...(vx ? { vx: vx[i] ?? null } : {}) }))
}

/** Which extra series a condition reads. */
export function extrasOf(text: string): { oi: boolean; dvol: boolean; vix: boolean } {
  return { oi: /\boi\b/.test(text), dvol: /\bdvol\b/.test(text), vix: /\bvix\b/.test(text) }
}

/** One file per series, compact: [[t, o, h, l, c, v], ...] or [[t, v], ...]. */
export function packCandles(rows: readonly Candle[]): string {
  return JSON.stringify(rows.map(c => [c.t, c.o, c.h, c.l, c.c, c.v]))
}

export function unpackCandles(text: string): Candle[] {
  try {
    const raw = JSON.parse(text) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(Array.isArray).map(k => ({ t: Number(k[0]), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) })).filter(c => Number.isFinite(c.t) && Number.isFinite(c.c))
  } catch {
    return []
  }
}

/** Hyperliquid's hourly funding kept on the PC: where the read started, then [[t, rate], ...], oldest first. */
export function packHlFunding(from: number, rows: readonly Funding[]): string {
  return JSON.stringify({ from, rows: rows.map(r => [r.t, r.rate]) })
}

export function unpackHlFunding(text: string): { from: number; rows: Funding[] } | null {
  try {
    const raw = JSON.parse(text) as { from?: unknown; rows?: unknown }
    if (typeof raw.from !== 'number' || !Number.isFinite(raw.from) || !Array.isArray(raw.rows)) return null
    const rows = raw.rows.filter(Array.isArray).map(k => ({ t: Number(k[0]), rate: Number(k[1]) })).filter(r => Number.isFinite(r.t) && Number.isFinite(r.rate))
    return { from: raw.from, rows }
  } catch {
    return null
  }
}

export function packPoints(rows: readonly { t: number; v?: number; rate?: number }[]): string {
  return JSON.stringify(rows.map(p => [p.t, p.v ?? p.rate]))
}

export function unpackPoints(text: string): Point[] {
  try {
    const raw = JSON.parse(text) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(Array.isArray).map(k => ({ t: Number(k[0]), v: Number(k[1]) })).filter(p => Number.isFinite(p.t) && Number.isFinite(p.v))
  } catch {
    return []
  }
}

export type Get = (url: string) => Promise<string>

/** Binance candles from `from` (or the listing) to now, page by page; newest last. A page that fails: its error and what came before it. */
export async function readKlines(get: Get, symbol: string, interval: string, from: number, now: number): Promise<Candle[] | { error: string; rows: Candle[] }> {
  const step = DEEP_STEP[interval] ?? HOUR
  let start = from
  let out: Candle[] = []
  for (let page = 0; page < 60 && start < now - step; page++) {
    const got = parseKlines(await get(klinesUrl(symbol, interval, start)))
    if ('error' in got) return { error: got.error, rows: out }
    if (got.length === 0) break
    out = mergeByTime(out, got)
    start = (got.at(-1) as Candle).t + step
    if (got.length < 1500) break
  }
  return out
}

/** Binance funding settlements from `from` to now; newest last. isComplete is false when Binance stopped answering partway. */
export async function readFunding(get: Get, symbol: string, from: number, now: number): Promise<{ rows: Funding[]; isComplete: boolean } | { error: string }> {
  let start = from
  let out: Funding[] = []
  for (let page = 0; page < 40; page++) {
    if (start >= now) return { rows: out, isComplete: true }
    const got = parseFundingRows(await get(fundingUrl(symbol, start)))
    if ('error' in got) return page === 0 ? got : { rows: out, isComplete: false }
    if (got.length === 0) return { rows: out, isComplete: true }
    out = mergeByTime(out, got)
    start = (got.at(-1) as Funding).t + 1
    if (got.length < 1000) return { rows: out, isComplete: true }
  }
  return { rows: out, isComplete: false }
}

/**
 * Bybit open interest over [from, to], read in up to 6 slices side by side (a slice is about 200 candles a page), so
 * three years of 1h take seconds, not a minute.
 */
export async function readOi(get: Get, symbol: string, interval: string, from: number, to: number): Promise<Point[] | { error: string }> {
  const slices = 6
  const width = Math.ceil((to - from) / slices)
  let firstError: string | null = null
  const parts = await Promise.all(
    Array.from({ length: slices }, async (_, s) => {
      const a = from + s * width
      const b = Math.min(to, a + width)
      let cursor = ''
      let rows: Point[] = []
      for (let page = 0; page < 80; page++) {
        const got = parseOi(await get(oiUrl(symbol, interval, a, b, cursor)).catch(() => '{}'))
        if ('error' in got) {
          firstError ??= got.error
          break
        }
        rows = rows.concat(got.rows)
        if (!got.cursor || got.rows.length === 0) break
        cursor = got.cursor
      }
      return rows
    }),
  )
  // Any slice cut short leaves a hole in the middle that a top-up from the last row never fills: all or nothing.
  if (firstError) return { error: firstError }
  return mergeByTime([], parts.flat())
}

/** Deribit DVOL daily, for BTC or ETH, from `from` to now. */
export async function readDvol(get: Get, currency: string, from: number, now: number): Promise<Point[] | { error: string }> {
  let end = now
  let out: Point[] = []
  for (let page = 0; page < 10; page++) {
    const got = parseDvol(await get(dvolUrl(currency, from, end)))
    if ('error' in got) return page === 0 ? got : out
    out = mergeByTime(out, got.rows)
    if (got.more === null || got.more <= from || got.rows.length === 0) break
    end = got.more
  }
  return out
}

/** The fear gauge for a coin: its own DVOL for BTC and ETH, BTC's for every other coin (crypto moves as one there). */
export function dvolCurrency(coin: string): 'BTC' | 'ETH' {
  return coin === 'ETH' ? 'ETH' : 'BTC'
}

/** Words for where the data came from, for the line under an answer. */
export function sourcesLine(deep: boolean, x: { oi: boolean; dvol: boolean; vix: boolean }): string {
  const parts = [deep ? 'Binance public API (candles, funding)' : 'Hyperliquid public API']
  if (x.oi) parts.push('Bybit (open interest)')
  if (x.dvol) parts.push('Deribit (DVOL)')
  if (x.vix) parts.push('FRED (VIX)')
  return `Market data: ${parts.join(', ')}`
}
