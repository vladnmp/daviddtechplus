// Price alerts: "/lab-alert BTC above 65000". The desk checks them against the live market every 30 s while any
// are set and tells the person once (toast and notification), then drops the alert. Pure: no `$`.

import type { Market, PriceAlert } from '../types'
import { resolveCoin } from './data'
import { fmtMark, priceOf } from './marks'
import { expandNamed, fmtScan, parseScan } from './scan'
import type { ScanHit } from './scan'

/** At most this many condition alerts ("SOL rsi < 30"): each reads candles while it waits. */
export const MAX_WHEN = 3

/** Words that start a condition, not a coin name. */
const CONDITION_WORDS = /^(ta\.|math\.|(rsi|ema|sma|hma|wma|rma|vwma|cci|roc|mom|atr|close|open|high|low|price|volume|hl2|hlc3|ohlc4)\b)/i

/**
 * "SOL rsi < 30", "ema 20 crosses above ema 50 on 4h" (the chart's coin): a condition alert, read like /lab-scan.
 * Null when the text is a plain price alert ("BTC > 65000", "SOL 200").
 */
export function parseWhenAlert(text: string, market: Market | null, chartCoin: string | null, chartInterval: string | null, now: number): PriceAlert | { error: string } | null {
  const words = text.trim().split(/\s+/).filter(w => w !== '')
  const first = words[0] ?? ''
  const named = first !== '' && !CONDITION_WORDS.test(first) ? resolveCoin(market, first) : null
  const rest = expandNamed(named ? words.slice(1).join(' ') : words.join(' '))
  const op = /\s+crosses\s+(above|below)\s+|\s*(<=|>=|<|>)\s*/i.exec(rest)
  if (!op) return null
  const before = rest.slice(0, op.index).trim()
  if (before === '' || priceOf(before) !== null) return null
  const scan = parseScan(rest)
  if ('error' in scan) return { error: scan.error.replace(/^Scan: /, 'Alert: ') }
  const coin = named ?? chartCoin ?? 'BTC'
  return { coin, dir: 'above', price: 0, note: '', at: now, when: scan.text, interval: scan.interval ?? chartInterval ?? '1h' }
}

/** A condition alert's scan text with its interval, ready for parseScan. */
export function whenScanText(a: PriceAlert): string {
  return `${a.when ?? ''} on ${a.interval ?? '1h'}`
}

/** What the person sees when a condition alert comes true. */
export function whenHitText(a: PriceAlert, hit: NonNullable<ScanHit>): string {
  return `${a.coin}: ${a.when} on ${a.interval} is true now (${fmtScan(hit.left)} vs ${fmtScan(hit.right)}).`
}

/** At most this many alerts at once, all coins together. */
export const MAX_ALERTS = 10

/**
 * "BTC above 65000", "eth below 3k", "SOL 200" (above or below from where price is now), "65000" (the chart's
 * coin). An alert that price is already past gives an error that says so.
 */
export function parseAlert(text: string, market: Market | null, chartCoin: string | null, now: number): PriceAlert | { error: string } {
  const words = text.trim().split(/\s+/).filter(w => w !== '')
  let coin: string | null = null
  let dir: 'above' | 'below' | null = null
  let price: number | null = null
  const rest: string[] = []
  for (const w of words) {
    const lw = w.toLowerCase()
    if (price === null && priceOf(w) !== null) price = priceOf(w)
    else if (dir === null && ['above', 'over', '>', 'crosses-above'].includes(lw)) dir = 'above'
    else if (dir === null && ['below', 'under', '<', 'crosses-below'].includes(lw)) dir = 'below'
    else if (coin === null && price === null && /^[a-z0-9]{1,12}$/i.test(w)) coin = w
    else rest.push(w)
  }
  if (price === null) return { error: 'Give a price: /lab-alert BTC above 65000, or /lab-alert SOL 200.' }
  const typed = coin ?? chartCoin ?? 'BTC'
  const found = resolveCoin(market, typed)
  if (!found) return { error: `No Hyperliquid perp named ${typed}.` }
  const last = market?.coins[found]?.price ?? null
  if (dir === null) {
    if (last === null) return { error: `Say above or below: /lab-alert ${found} above ${fmtMark(price)}.` }
    dir = price >= last ? 'above' : 'below'
  }
  if (last !== null && (dir === 'above' ? last >= price : last <= price))
    return { error: `${found} is already ${dir} ${fmtMark(price)} (now ${fmtMark(last)}).` }
  return { coin: found, dir, price, note: rest.join(' ').slice(0, 40), at: now }
}

/** The alerts the market reached, and the ones still waiting. */
export function hitAlerts(alerts: readonly PriceAlert[], market: Market): { hit: { alert: PriceAlert; price: number }[]; left: PriceAlert[] } {
  const hit: { alert: PriceAlert; price: number }[] = []
  const left: PriceAlert[] = []
  for (const a of alerts) {
    // Condition alerts are checked on candles, apart from the price.
    if (a.when) {
      left.push(a)
      continue
    }
    const price = market.coins[a.coin]?.price
    if (price !== undefined && (a.dir === 'above' ? price >= a.price : price <= a.price)) hit.push({ alert: a, price })
    else left.push(a)
  }
  return { hit, left }
}

/** "BTC above 65,000" plus its note. */
export function alertText(a: PriceAlert): string {
  if (a.when) return `${a.coin} when ${a.when} on ${a.interval ?? '1h'}`
  return `${a.coin} ${a.dir} ${fmtMark(a.price)}${a.note ? ` (${a.note})` : ''}`
}

/** What the person sees when one is reached. */
export function hitText(a: PriceAlert, price: number): string {
  return `${a.coin} is ${a.dir} ${fmtMark(a.price)}: now ${fmtMark(price)}.${a.note ? ` ${a.note}.` : ''}`
}
