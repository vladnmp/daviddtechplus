// DaviddTech+ forecast overlay: finding the server, reading analyze_asset's
// structured brief (forecast_path p10..p90, % from the reference close) and
// turning it into prices to the right of the last candle. Pure: no `$`.

import type { Fan, FanPoint } from '../types'

export const CONNECTOR_URL = 'https://vlad-64070--daviddtech-plus.modal.run/mcp'
export const SOURCE_LINE = 'Source: DaviddTech+ (skool.com/daviddtech/about)'
export const MISSING_HINT =
  `Add DaviddTech+ to see its forecast range here: claude.ai Settings > Connectors > Add custom connector, URL ${CONNECTOR_URL}`
/** The same hint as two short lines, so a narrow pane still shows the URL whole. */
/** The same hint in one short line (the setup page), for a cramped terminal pane. */
export const MISSING_SHORT = ['Add the forecast range: davidd.link/daviddtechplus'] as const
export const MISSING_LINES = ['Add DaviddTech+ to see its forecast range here: claude.ai Settings > Connectors > Add custom connector, URL:', CONNECTOR_URL] as const
/** Names tried after the ones found by their tools: the claude.ai connector, `claude mcp add daviddtechplus`, the plugin's own. */
export const SERVERS = ['claude.ai DaviddTech+', 'daviddtechplus', 'plugin:daviddtechplus:daviddtechplus']
export const FORECAST_TTL_MS = 6 * 60 * 60 * 1000

const ANALYZE = /^mcp__(.+)__analyze_asset$/

/** Servers whose analyze_asset tool the session lists and whose name holds "daviddtech". */
export function serversFromTools(tools: readonly { name: string }[]): string[] {
  const found: string[] = []
  for (const t of tools) {
    const m = ANALYZE.exec(t.name)
    const server = m?.[1]
    if (server && /daviddtech/i.test(server) && !found.includes(server)) found.push(server)
  }
  return found
}

/** The names to try, in order: the ones found by their tools, then the usual names. */
export function serverCandidates(tools: readonly { name: string }[]): string[] {
  const found = serversFromTools(tools)
  return [...found, ...SERVERS.filter(s => !found.includes(s))]
}

/** DaviddTech+'s symbol for a Hyperliquid perp: BTC -> BTC/USD, kPEPE -> PEPE/USD. */
export function symbolFor(coin: string): string {
  const base = /^k[A-Z]/.test(coin) ? coin.slice(1) : coin
  return `${base.toUpperCase()}/USD`
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** The fan in analyze_asset's structured content, or null when it holds none. */
export function fanFrom(structured: unknown): Fan | null {
  const b = structured as {
    instrument?: { symbol?: unknown }
    data?: { last_session?: unknown; reference_price?: unknown }
    horizon?: { steps?: unknown; unit?: unknown }
    forecast_path?: unknown
    at_your_price?: { price_now?: unknown; range_80_at_horizon?: unknown; central_path_at_horizon?: unknown } | null
  } | null
  if (!b || typeof b !== 'object' || !Array.isArray(b.forecast_path)) return null
  const points: FanPoint[] = [{ step: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 }]
  for (const raw of b.forecast_path as Record<string, unknown>[]) {
    const step = num(raw?.step)
    const p10 = num(raw?.p10)
    const p25 = num(raw?.p25)
    const p50 = num(raw?.p50)
    const p75 = num(raw?.p75)
    const p90 = num(raw?.p90)
    if (step === null || p10 === null || p25 === null || p50 === null || p75 === null || p90 === null) continue
    if (step <= 0) continue
    points.push({ step, p10, p25, p50, p75, p90 })
  }
  points.sort((a, b2) => a.step - b2.step)
  if (points.length < 2) return null
  const last = points[points.length - 1]
  // The server's own prices at the live price the desk sent (price_now): the anchor, the 80% range and the middle.
  const y = b.at_your_price
  const live = num(y?.price_now)
  const raw80 = y?.range_80_at_horizon
  const r80 = Array.isArray(raw80) ? raw80.map(num) : []
  const lo = r80[0] ?? null
  const hi = r80[1] ?? null
  return {
    symbol: typeof b.instrument?.symbol === 'string' ? b.instrument.symbol : '',
    steps: num(b.horizon?.steps) ?? (last ? last.step : points.length - 1),
    unit: typeof b.horizon?.unit === 'string' ? b.horizon.unit : 'days',
    asOf: typeof b.data?.last_session === 'string' ? b.data.last_session : null,
    referencePrice: num(b.data?.reference_price),
    livePrice: live !== null && live > 0 ? live : null,
    range80: live !== null && lo !== null && hi !== null ? [lo, hi] : null,
    middle: live !== null ? num(y?.central_path_at_horizon) : null,
    points,
  }
}

/** What get_usage says about the account, and nothing else (its email is never kept). */
export type Tier = { tier: 'member' | 'guest' | null; left: number | null; limit: number | null }

/** The tier, requests left and daily limit from get_usage's structured content; unknowns stay null. */
export function tierFrom(structured: unknown): Tier {
  const u = (structured ?? {}) as { tier?: unknown; remaining_today?: unknown; daily_limit?: unknown }
  const tier = u.tier === 'guest' || u.tier === 'member' ? u.tier : null
  return { tier, left: num(u.remaining_today), limit: num(u.daily_limit) }
}

/** The line a guest reads before the desk spends a request on the range. */
export function guestNote(t: Tier): string {
  if (t.left !== null && t.left <= 0) return 'Guest account: no requests left today, so no DaviddTech+ range. Market weather is still free.'
  const left = t.left !== null && t.limit !== null ? ` (${t.left} of ${t.limit} left today)` : ''
  return `Guest account: the DaviddTech+ range uses 1 daily request${left}.`
}

/** The question the footer button puts in the prompt box. */
export function nextQuestion(coin: string, horizon: number, price: number | null, fmt: (p: number) => string): string {
  const at = price !== null && price > 0 ? ` at the live price ${fmt(price)} (price_now)` : ''
  return `Analyze ${symbolFor(coin)} with DaviddTech+ for the next ${horizon} days${at}.`
}

/** The first line of an MCP answer's text, for a short note. */
export function firstText(content: readonly { type: string; text?: string }[] | undefined): string {
  const text = (content ?? []).find(c => c.type === 'text' && typeof c.text === 'string')?.text ?? ''
  const line = text.split('\n').map(l => l.trim()).find(l => l !== '') ?? ''
  return line.length > 160 ? line.slice(0, 159) + '…' : line
}

/**
 * The price the fan's % moves start from: the live price the desk sent as
 * price_now when the server answered with it (the server's own prices start
 * there too). Older answers: the server's reference close when it fits the
 * chart; Hyperliquid's k-coins (kPEPE, kSHIB...) quote 1000 units, so a
 * reference 1/1000 of the chart is scaled up; a reference still more than 50%
 * away from the chart's last price is not used and the last price anchors it.
 */
export function fanAnchor(fan: Fan, lastPrice: number): number {
  if (fan.livePrice != null && fan.livePrice > 0) return fan.livePrice
  const ref = fan.referencePrice
  if (ref === null || !(ref > 0)) return lastPrice
  if (!(lastPrice > 0)) return ref
  for (const scaled of [ref, ref * 1000]) {
    if (Math.abs(scaled / lastPrice - 1) <= 0.5) return scaled
  }
  return lastPrice
}

export type FanPrices = { x: number; p10: number; p25: number; p50: number; p75: number; p90: number }

/** The fan as prices, anchored at the reference close (or `lastPrice` when the server shows none), at `t` in 0..1 of the horizon. */
export function fanAt(fan: Fan, lastPrice: number, t: number): FanPrices {
  const anchor = fanAnchor(fan, lastPrice)
  const maxStep = fan.points[fan.points.length - 1]?.step ?? 1
  const s = Math.max(0, Math.min(1, t)) * maxStep
  let i = 0
  while (i < fan.points.length - 2 && (fan.points[i + 1]?.step ?? 0) < s) i++
  const a = fan.points[i]
  const b = fan.points[i + 1] ?? a
  if (!a || !b) return { x: t, p10: anchor, p25: anchor, p50: anchor, p75: anchor, p90: anchor }
  const span = b.step - a.step
  const f = span > 0 ? (s - a.step) / span : 0
  const at = (k: 'p10' | 'p25' | 'p50' | 'p75' | 'p90') => anchor * (1 + (a[k] + (b[k] - a[k]) * f) / 100)
  return { x: t, p10: at('p10'), p25: at('p25'), p50: at('p50'), p75: at('p75'), p90: at('p90') }
}

/** The lowest and highest prices the fan reaches. */
export function fanRange(fan: Fan, lastPrice: number): [number, number] {
  const anchor = fanAnchor(fan, lastPrice)
  let lo = anchor
  let hi = anchor
  for (const p of fan.points) {
    lo = Math.min(lo, anchor * (1 + p.p10 / 100))
    hi = Math.max(hi, anchor * (1 + p.p90 / 100))
  }
  return [lo, hi]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dayLabel(iso: string | null): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  if (!m) return null
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ''}`
}

/** "day" or "days", "session" or "sessions": singular at 1. */
export function stepWord(unit: string, steps: number): string {
  const noun = /session/i.test(unit) ? 'session' : 'day'
  return steps === 1 ? noun : `${noun}s`
}

/**
 * The 80% range in words, in the first form that fits `columns`: one line
 * (F1, F2) or two (F3a or F4a, then F3b, F3c or F4b). `lo` and `hi` come
 * ready to print (prices here, percents in daviddtech-charts).
 */
export function rangeCaption(lo: string, hi: string, steps: number, unit: string, columns: number): string[] {
  const u = stepWord(unit, steps)
  const isDays = u.startsWith('day')
  const f1 = `80% range ${lo} to ${hi} · 1 in 10 ends above ${hi}, 1 in 10 below ${lo} (${steps} ${u})`
  if (f1.length <= columns) return [f1]
  const f2 = `80% range ${lo} to ${hi} · 1 in 10 ends above, 1 in 10 below (${steps} ${u})`
  if (f2.length <= columns) return [f2]
  const f3a = `80% range ${lo} to ${hi} (${steps} ${u})`
  const first = f3a.length <= columns || !isDays ? f3a : `80% ${lo} to ${hi} (${steps}d)`
  const seconds = [`1 in 10 ends above ${hi}, 1 in 10 below ${lo}`, '1 in 10 ends above, 1 in 10 below', '1 in 10 above, 1 in 10 below']
  return [first, seconds.find(t => t.length <= columns) ?? '1 in 10 above, 1 in 10 below']
}

/** The dim legend under a one-line caption: the darker shade, the middle and where the range starts, as much as fits. */
export function legendLine(fan: Fan, lastPrice: number, fmt: (p: number) => string, columns: number): string {
  const end = fanAt(fan, lastPrice, 1)
  const anchor = fanAnchor(fan, lastPrice)
  const ref = fan.referencePrice
  const isLive = fan.livePrice != null && fan.livePrice > 0
  const isFromLatest = !isLive && (ref === null || (anchor !== ref && anchor !== ref * 1000))
  const from = dayLabel(fan.asOf)
  const start = isLive ? ` · at the live price ${fmt(anchor)}` : isFromLatest ? ' · from the latest price' : from ? ` · from the ${from} close` : ''
  const range50 = `50% range ${fmt(end.p25)} to ${fmt(end.p75)}`
  const middle = ` · middle ${fmt(fan.middle ?? end.p50)}`
  const forms = [`Darker shade: ${range50}${middle}${start}`, `Darker shade: ${range50}${middle}`, `${range50}${middle}`]
  return forms.find(t => t.length <= columns) ?? range50
}

export type FanCaption = { lineA: string; lineB: string; isLegend: boolean }

/**
 * The two caption rows under the chart (the source line is the third). Built
 * here from the forecast's percents and the chart's own price, so a
 * DaviddTech+ that shows only percents changes nothing.
 */
export function fanCaption(fan: Fan, lastPrice: number, fmt: (p: number) => string, columns: number): FanCaption {
  const end = fanAt(fan, lastPrice, 1)
  const [lo, hi] = fan.range80 ?? [end.p10, end.p90]
  const lines = rangeCaption(fmt(lo), fmt(hi), fan.steps, fan.unit, columns)
  const [a = '', b] = lines
  if (b !== undefined) return { lineA: a, lineB: b, isLegend: false }
  return { lineA: a, lineB: legendLine(fan, lastPrice, fmt, columns), isLegend: true }
}
