// The member's own candle file: a CSV they exported (TradingView's "Export chart data", a broker's history), read on
// their PC. One strict format, so the member's AI can reshape anything else to it: a header row with time, open, high,
// low, close and an optional volume, then one candle a row, oldest or newest first.

import type { Candle } from '../types'

export const FILE_HEADER = 'time,open,high,low,close,volume'
/** Most candles kept from one file, as deep history keeps. */
export const FILE_MAX = 50_000
const FILE_STEPS: [string, number][] = [['1m', 60_000], ['5m', 300_000], ['15m', 900_000], ['1h', 3_600_000], ['4h', 14_400_000], ['1d', 86_400_000], ['1w', 604_800_000]]

/** A row's time as UTC ms: unix seconds or ms, or an ISO date/time (no zone given reads as UTC, never local time). */
export function fileTime(raw: string): number | null {
  const s = raw.trim().replace(/^"|"$/g, '')
  if (/^\d{9,13}(\.\d+)?$/.test(s)) {
    const n = Number(s)
    return n < 1e11 ? Math.round(n * 1000) : Math.round(n)
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s)
  if (!m) return null
  const [, y, mo, d, hh = '00', mm = '00', ss = '00', zone] = m
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss))
  if (!Number.isFinite(t)) return null
  if (!zone || /^z$/i.test(zone)) return t
  const z = /^([+-])(\d{2}):?(\d{2})$/.exec(zone)
  if (!z) return null
  const off = (Number(z[2]) * 60 + Number(z[3])) * 60_000
  return z[1] === '+' ? t - off : t + off
}

/** The Lab interval a spacing is, within 2%; null when it is none of them. */
export function fileInterval(stepMs: number): string | null {
  return FILE_STEPS.find(([, ms]) => Math.abs(stepMs - ms) <= ms * 0.02)?.[0] ?? null
}

/** A market's name as said back and as its tries are kept: letters, digits and . - _ only, up to 16. */
export function marketLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // "SPY (file)" as the answers say it back reads as SPY again.
  const s = raw.trim().toUpperCase().replace(/^[A-Z]+:/, '').replace(/\s*\(FILE\)$/, '')
  return /^[A-Z0-9][A-Z0-9._-]{0,15}$/.test(s) ? s : null
}

/**
 * A candle file's closed candles, oldest first, and the interval they are. Rows sorted and one per time (the later
 * row wins), a candle not closed by `now` left out (an export takes the forming one too), and the start moved to two
 * candles one interval apart, so a weekend or a night between the first two never reads as the interval.
 */
export function parseCandleFile(text: string, now: number): { candles: Candle[]; interval: string; skipped: number; trimmed: number } | { error: string } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '')
  const want = `The file needs a header row like ${FILE_HEADER} (volume optional; time as unix seconds or an ISO date like 2024-01-31 or 2024-01-31T14:30Z), then one candle a row.`
  if (lines.length < 2) return { error: `The file has no candles. ${want}` }
  const sep = (lines[0] as string).includes(';') && !(lines[0] as string).includes(',') ? ';' : ','
  const head = (lines[0] as string).split(sep).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase())
  const col = (names: string[]) => head.findIndex(h => names.includes(h))
  const at = { t: col(['time', 'time_utc', 'date', 'datetime', 'timestamp']), o: col(['open']), h: col(['high']), l: col(['low']), c: col(['close']), v: col(['volume', 'vol']) }
  // What the first row lacks is said, never the row itself: a wrong file's contents stay out of the chat.
  const lacks = Object.entries({ time: at.t, open: at.o, high: at.h, low: at.l, close: at.c }).filter(([, i]) => i < 0).map(([k]) => k)
  if (lacks.length > 0) return { error: `The file's first row has no ${lacks.join(', ')} column${lacks.length === 1 ? '' : 's'}. ${want}` }
  const byTime = new Map<number, Candle>()
  let skipped = 0
  for (const line of lines.slice(1)) {
    const cells = line.split(sep)
    const t = fileTime(cells[at.t] ?? '')
    const num = (i: number) => Number((cells[i] ?? '').trim().replace(/^"|"$/g, ''))
    const k = { o: num(at.o), h: num(at.h), l: num(at.l), c: num(at.c) }
    const v = at.v >= 0 ? num(at.v) : 0
    if (t === null || ![k.o, k.h, k.l, k.c].every(x => Number.isFinite(x) && x > 0) || k.h < Math.max(k.o, k.c) * 0.9999 || k.l > Math.min(k.o, k.c) * 1.0001) {
      skipped++
      continue
    }
    byTime.set(t, { t, ...k, v: Number.isFinite(v) ? v : 0 })
  }
  const rows = [...byTime.values()].sort((a, b) => a.t - b.t)
  if (rows.length < 3) return { error: `The file has ${rows.length} candle${rows.length === 1 ? '' : 's'} that read${skipped ? ` (${skipped} rows did not)` : ''}. ${want}` }
  if (skipped > rows.length * 0.05) return { error: `${skipped} of ${skipped + rows.length} rows did not read as candles. ${want}` }
  const gaps = rows.slice(1).map((k, i) => k.t - (rows[i] as Candle).t).sort((a, b) => a - b)
  const step = gaps[Math.floor(gaps.length / 2)] as number
  const interval = fileInterval(step)
  if (!interval) return { error: `The file's candles are about ${Math.round(step / 60_000)} minutes apart; the Lab reads 1m, 5m, 15m, 1h, 4h, 1d or 1w candles.` }
  const exact = FILE_STEPS.find(([iv]) => iv === interval)?.[1] ?? step
  const all = rows.filter(k => k.t + exact <= now)
  // As many as deep history at most: a long 1m export keeps its latest FILE_MAX candles, and the answer says so.
  const closed = all.length > FILE_MAX ? all.slice(all.length - FILE_MAX) : all
  let first = 0
  while (first < closed.length - 1 && Math.abs((closed[first + 1] as Candle).t - (closed[first] as Candle).t - exact) > exact * 0.02) first++
  return { candles: closed.slice(first), interval, skipped, trimmed: all.length - closed.length }
}
